import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentEvent, AgentId, AgentUsage, Task } from '../shared/types';
import type { Adapter, Outcome, ParsedLine } from './adapter';
import { detectLimit } from './limit';
import { runProcess } from './process';
import type { TaskStore } from './taskStore';
import { addUsage } from './usage';
import { changes, createWorktree, removeWorktree } from './worktree';

export interface Emitter {
  update(task: Task): void;
  event(id: string, e: AgentEvent): void;
  /** 구독 한도 사용률이 새로 들어왔을 때 */
  usage?(u: AgentUsage): void;
}

export function promptFor(task: Task): string {
  const plan = task.consult?.decision?.plan?.trim();
  return plan ? `${task.prompt}\n\n합의된 계획:\n${plan}` : task.prompt;
}

const AUTH_RE = /not logged in|log ?in|unauthorized|authenticat|\b401\b/i;

// Codex는 매 실행마다 MCP 서버 인증 오류(rmcp::)를 stderr에 찍는다. 작업과 무관한 잡음이라 뺀다
function cleanStderr(stderr: string): string {
  return stderr
    .split('\n')
    .filter((l) => !/rmcp::/.test(l))
    .join('\n')
    .trim();
}

// 설계 4절: 로그인 문제로 실패하면 터미널 로그인 안내를 앞에 붙인다
function withLoginHint(o: Outcome): Outcome {
  if (o.status !== 'failed' || !AUTH_RE.test(o.message)) return o;
  return { status: 'failed', message: `로그인이 필요합니다. 터미널에서 claude 또는 codex에 로그인하세요.\n${o.message}` };
}

export function resolveOutcome(outcome: Outcome | undefined, code: number | null, rawStderr: string): Outcome {
  const stderr = cleanStderr(rawStderr);
  if (outcome && outcome.status !== 'done') return withLoginHint(outcome);
  const lim = detectLimit(stderr);
  if (code !== 0 && lim.limited) return { status: 'limited', message: stderr.slice(-500), resetHint: lim.resetHint };
  if (code === 0) return outcome ?? { status: 'done' };
  return withLoginHint({ status: 'failed', message: stderr.slice(-500) || `종료 코드 ${code}` });
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface RunEntry {
  kill(): void;
  stop?: 'cancelled' | 'interrupted';
}

export class TaskRunner {
  private running = new Map<string, RunEntry>();

  constructor(
    private store: TaskStore,
    private adapters: Record<AgentId, Adapter>,
    private emit: Emitter,
    private logDir: string,
  ) {}

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  private mustGet(id: string): Task {
    const t = this.store.get(id);
    if (!t) throw new Error(`작업을 찾을 수 없습니다: ${id}`);
    return t;
  }

  private publish(task: Task): void {
    this.store.save(task);
    this.emit.update(task);
  }

  // 첫 await 전에 동기적으로 실행 중으로 표시해, 두 번 누르기나 준비 중 취소가 끼어들 틈을 없앤다
  private claim(id: string): RunEntry {
    if (this.running.has(id)) throw new Error('이미 실행 중인 작업입니다');
    const entry: RunEntry = { kill: () => {} };
    this.running.set(id, entry);
    return entry;
  }

  async start(id: string): Promise<void> {
    const task = this.mustGet(id);
    const entry = this.claim(id);
    task.status = 'running';
    this.publish(task);
    const adapter = this.adapters[task.agent!];
    if (!adapter.isAvailable()) {
      this.running.delete(id);
      return this.finish(task, { status: 'failed', message: `${adapter.id}가 설치돼 있지 않습니다. 설치하거나 PATH를 확인하세요.` });
    }
    try {
      const wt = await createWorktree(task.repo, task.id);
      task.worktree = wt.path;
      task.branch = wt.branch;
    } catch (e) {
      this.running.delete(id);
      return this.finish(task, { status: 'failed', message: `worktree 생성 실패: ${errMsg(e)}` });
    }
    if (entry.stop) {
      this.running.delete(id);
      return this.finish(task, { status: entry.stop });
    }
    await this.exec(task, entry, adapter.runArgs(promptFor(task), task.worktree, task.models?.[task.agent!]));
  }

  async resume(id: string): Promise<void> {
    const task = this.mustGet(id);
    if (!task.sessionId || !task.worktree || this.isRunning(id)) {
      throw new Error('이어서 할 수 없는 작업입니다 (세션 정보가 없거나 실행 중)');
    }
    const entry = this.claim(id);
    task.status = 'running';
    task.error = undefined;
    task.resetHint = undefined;
    task.endedAt = undefined;
    this.publish(task);
    const adapter = this.adapters[task.agent!];
    await this.exec(task, entry, adapter.resumeArgs(task.sessionId, task.worktree, task.models?.[task.agent!]));
  }

  cancel(id: string): void {
    const r = this.running.get(id);
    if (!r) return;
    r.stop = 'cancelled';
    r.kill();
  }

  // 앱 종료 시: Windows는 부모가 끝나도 자식 프로세스를 죽이지 않으므로 직접 끝낸다
  killAll(): void {
    for (const r of this.running.values()) {
      r.stop = 'interrupted';
      r.kill();
    }
  }

  async cleanup(id: string): Promise<void> {
    const task = this.mustGet(id);
    if (this.isRunning(id) || task.status === 'running' || task.status === 'consulting') {
      throw new Error('실행 중인 작업은 정리할 수 없습니다');
    }
    if (task.worktree) await removeWorktree(task.repo, task.id);
    task.worktree = undefined;
    task.branch = undefined;
    this.publish(task);
  }

  readEvents(id: string): AgentEvent[] {
    const task = this.mustGet(id);
    const file = join(this.logDir, `${id}.jsonl`);
    if (!existsSync(file) || !task.agent) return [];
    const adapter = this.adapters[task.agent];
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => safeParse(adapter, l).events);
  }

  private async exec(task: Task, entry: RunEntry, args: string[]): Promise<void> {
    const adapter = this.adapters[task.agent!];
    mkdirSync(this.logDir, { recursive: true });
    const logFile = join(this.logDir, `${task.id}.jsonl`);
    let outcome: Outcome | undefined;

    const handle = runProcess(adapter.command(), args, task.worktree!, (line) => {
      try {
        appendFileSync(logFile, `${line}\n`);
        const p = safeParse(adapter, line);
        if (p.sessionId) task.sessionId = p.sessionId;
        if (p.model) task.model = p.model;
        addUsage(task.usage, p.usageDelta);
        // 한도 신호 뒤의 일반 실패 줄이 원인을 덮지 않게 하되, 성공(done)은 그대로 인정한다
        if (p.outcome && (outcome?.status !== 'limited' || p.outcome.status === 'done')) outcome = p.outcome;
        for (const e of p.events) this.emit.event(task.id, e);
        if (p.usageInfo) this.emit.usage?.(p.usageInfo);
        if (p.halt) handle.kill();
        if (p.sessionId || p.usageDelta) this.publish(task);
      } catch (e) {
        // 저장 실패(예: 백신이 파일을 잡고 있음)가 작업 전체를 멈추게 하지 않는다
        this.emit.event(task.id, { kind: 'error', message: `기록 실패: ${errMsg(e)}` });
      }
    });
    entry.kill = handle.kill;
    if (entry.stop) handle.kill(); // 프로세스가 뜨기 직전에 중지된 경우
    const res = await handle.done;
    this.running.delete(task.id);

    const final: Outcome = entry.stop
      ? { status: entry.stop }
      : res.spawnError
        ? {
            status: 'failed',
            message: /ENOENT/.test(res.spawnError)
              ? `CLI를 찾을 수 없습니다 (${adapter.id}): ${res.spawnError}`
              : `CLI를 실행하지 못했습니다 (${adapter.id}): ${res.spawnError}`,
          }
        : resolveOutcome(outcome, res.code, res.stderr);
    if (!task.model && task.sessionId && adapter.modelOfSession) {
      try {
        task.model = adapter.modelOfSession(task.sessionId);
      } catch {
        // 모델을 못 찾아도 작업 결과에는 영향 없음
      }
    }
    try {
      const c = await changes(task.worktree!);
      task.changedFiles = c.files;
      task.diffStat = c.stat;
    } catch {
      // worktree가 사라졌으면 변경 정보 없이 끝낸다
    }
    this.finish(task, final);
  }

  private finish(task: Task, o: Outcome): void {
    task.status = o.status;
    task.error = 'message' in o ? o.message : undefined;
    task.resetHint = o.status === 'limited' ? o.resetHint : undefined;
    task.endedAt = new Date().toISOString();
    this.publish(task);
  }
}

function safeParse(adapter: Adapter, line: string): ParsedLine {
  try {
    return adapter.parseLine(line);
  } catch {
    return { events: [{ kind: 'raw', line }] };
  }
}
