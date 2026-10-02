import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentId, Decision, Opinion, OpinionResult, Task, Usage } from '../shared/types';
import type { Adapter } from './adapter';
import { runProcess } from './process';
import type { Emitter } from './runner';
import type { TaskStore } from './taskStore';
import { addUsage } from './usage';

const AGENTS: AgentId[] = ['claude', 'codex'];
const NAME: Record<AgentId, string> = { claude: 'Claude Code(Anthropic)', codex: 'Codex(OpenAI)' };
const other = (a: AgentId): AgentId => (a === 'claude' ? 'codex' : 'claude');

export function opinionPrompt(self: AgentId, request: string): string {
  return [
    `너는 ${NAME[self]}다. 아래 작업 요청을 너와 ${NAME[other(self)]} 중 누가 맡는 게 좋은지 판단해라.`,
    '파일을 수정하지 말고, 필요하면 저장소를 읽기만 해라.',
    '답은 다른 말 없이 JSON 한 개만 출력한다:',
    '{"approach": "내가 맡는다면 어떻게 할지 3줄 이내", "difficulty": 1~5 정수, "fit": "me" | "other" | "either", "reason": "판단 이유 1~2문장"}',
    'fit: me = 내가 맡는 게 낫다, other = 상대가 낫다, either = 누가 해도 비슷하다',
    '',
    '작업 요청:',
    request,
  ].join('\n');
}

export function decidePrompt(request: string, opinions: Record<AgentId, Opinion>): string {
  return [
    '두 AI의 의견을 보고 이 작업의 최종 담당과 실행 계획을 정해라. 파일은 수정하지 마라.',
    '답은 다른 말 없이 JSON 한 개만 출력한다:',
    '{"assignee": "claude" | "codex", "reason": "이유 1~2문장", "plan": "담당 AI가 따를 실행 계획 5줄 이내"}',
    '',
    `작업 요청:\n${request}`,
    '',
    `Claude 의견: ${JSON.stringify(opinions.claude)}`,
    `Codex 의견: ${JSON.stringify(opinions.codex)}`,
  ].join('\n');
}

// '{'에서 시작해 문자열 안의 괄호는 무시하며 짝이 맞는 '}'까지 잘라낸다
function balancedAt(text: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

// 코드펜스 안쪽을 먼저, 그다음 전체 글에서 JSON 객체 후보를 차례로 찾는다
function jsonObjects(text: string): Record<string, unknown>[] {
  const fences = [...text.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const found: Record<string, unknown>[] = [];
  for (const body of [...fences, text]) {
    for (let i = body.indexOf('{'); i >= 0; i = body.indexOf('{', i + 1)) {
      const chunk = balancedAt(body, i);
      if (!chunk) continue;
      try {
        const v = JSON.parse(chunk);
        if (v && typeof v === 'object' && !Array.isArray(v)) found.push(v);
      } catch {
        // JSON이 아닌 {…}는 건너뛴다
      }
    }
  }
  return found;
}

export function extractJson(text: string): unknown {
  return jsonObjects(text)[0] ?? null;
}

export function parseOpinion(text: string): Opinion | null {
  const o = jsonObjects(text).find((c) => typeof c.approach === 'string' && ['me', 'other', 'either'].includes(c.fit as string));
  if (!o || typeof o.approach !== 'string' || typeof o.reason !== 'string') return null;
  if (o.fit !== 'me' && o.fit !== 'other' && o.fit !== 'either') return null;
  const d = Number(o.difficulty);
  return {
    approach: o.approach,
    reason: o.reason,
    fit: o.fit,
    difficulty: Number.isFinite(d) ? Math.min(5, Math.max(1, Math.round(d))) : 3,
  };
}

export function parseDecision(text: string): Decision | null {
  const o = jsonObjects(text).find((c) => c.assignee === 'claude' || c.assignee === 'codex');
  if (!o || (o.assignee !== 'claude' && o.assignee !== 'codex')) return null;
  if (typeof o.reason !== 'string' || typeof o.plan !== 'string') return null;
  return { assignee: o.assignee, reason: o.reason, plan: o.plan };
}

const isOpinion = (r: OpinionResult | undefined): r is Opinion => !!r && !('error' in r);

function pick(self: AgentId, fit: Opinion['fit']): AgentId | null {
  if (fit === 'me') return self;
  if (fit === 'other') return other(self);
  return null;
}

export function decideByRule(ops: Partial<Record<AgentId, OpinionResult>>): Decision | 'need-decider' | 'manual' {
  const valid = AGENTS.filter((a) => isOpinion(ops[a]));
  if (valid.length === 0) return 'manual';
  if (valid.length === 1) {
    const a = valid[0];
    const o = ops[a] as Opinion;
    return { assignee: pick(a, o.fit) ?? a, reason: o.reason, plan: o.approach };
  }
  const [p1, p2] = valid.map((a) => pick(a, (ops[a] as Opinion).fit));
  if (p1 && p1 === p2) {
    return { assignee: p1, reason: `두 AI 모두 ${p1}를 추천`, plan: (ops[p1] as Opinion).approach };
  }
  return 'need-decider';
}

export type RunOnce = (
  adapter: Adapter,
  args: string[],
  cwd: string,
  onLine?: (line: string) => void,
) => Promise<{ finalText: string; usage: Usage; error?: string }>;

const OPINION_TIMEOUT_MS = 3 * 60 * 1000;

export const runOnce: RunOnce = async (adapter, args, cwd, onLine) => {
  let finalText = '';
  const usage: Usage = {};
  let error: string | undefined;
  const h = runProcess(adapter.command(), args, cwd, (line) => {
    onLine?.(line);
    let p;
    try {
      p = adapter.parseLine(line);
    } catch {
      return;
    }
    if (p.finalText) finalText = p.finalText;
    addUsage(usage, p.usageDelta);
    if (p.outcome && 'message' in p.outcome) error = p.outcome.message;
  });
  const timer = setTimeout(() => {
    error = '시간 초과';
    h.kill();
  }, OPINION_TIMEOUT_MS);
  const res = await h.done;
  clearTimeout(timer);
  if (res.spawnError) error = `CLI를 찾을 수 없습니다: ${res.spawnError}`;
  else if (!error && res.code !== 0) error = res.stderr.trim().slice(-300) || `종료 코드 ${res.code}`;
  return { finalText, usage, error };
};

export class Consultant {
  constructor(
    private store: TaskStore,
    private adapters: Record<AgentId, Adapter>,
    private emit: Emitter,
    private run: RunOnce = runOnce,
    private logDir?: string,
  ) {}

  private publish(task: Task): void {
    this.store.save(task);
    this.emit.update(task);
  }

  // 설계 7절: 상의 단계의 원본 출력도 작업 로그에 남긴다(의견 JSON을 못 읽었을 때 원문을 볼 수 있게)
  private logger(id: string): ((line: string) => void) | undefined {
    if (!this.logDir) return undefined;
    const dir = this.logDir;
    mkdirSync(dir, { recursive: true });
    return (line) => {
      try {
        appendFileSync(join(dir, `${id}.jsonl`), `${line}\n`);
      } catch {
        // 로그 실패가 상의를 멈추게 하지 않는다
      }
    };
  }

  /** unavailable: 사용률 보호선(90%)에 걸려 쓸 수 없는 AI(설계 14절) */
  async consult(id: string, unavailable: AgentId[] = []): Promise<void> {
    const task = this.store.get(id);
    if (!task) return;
    task.status = 'consulting';
    task.consult = { opinions: {} };
    this.publish(task);

    const blocked = AGENTS.find((a) => unavailable.includes(a));
    if (blocked) {
      task.consult.decision = { assignee: other(blocked), reason: `${blocked}의 구독 사용률이 90%를 넘어 상의 없이 배정`, plan: '' };
      return this.publish(task);
    }

    const limited = AGENTS.find((a) => this.store.recentlyLimited(a));
    if (limited) {
      task.consult.decision = {
        assignee: other(limited),
        reason: `${limited}가 최근 사용량 한도에 걸려 있어 상의 없이 배정`,
        plan: '',
      };
      return this.publish(task);
    }

    const log = this.logger(id);
    // ponytail: 상의 중 취소해도 의견 프로세스는 끝까지 돈다(읽기 전용·상한·3분 제한이 있어 피해가 작음)
    const results = await Promise.all(
      AGENTS.map(async (a) => {
        const ad = this.adapters[a];
        const r = await this.run(ad, ad.opinionArgs(opinionPrompt(a, task.prompt), task.repo), task.repo, log);
        addUsage(task.usage, r.usage);
        const parsed = r.error ? null : parseOpinion(r.finalText);
        return [a, parsed ?? { error: r.error ?? '의견 JSON을 읽지 못함' }] as const;
      }),
    );
    if (task.status !== 'consulting') return;
    task.consult.opinions = Object.fromEntries(results) as Partial<Record<AgentId, OpinionResult>>;

    const rule = decideByRule(task.consult.opinions);
    if (rule === 'need-decider') {
      this.publish(task); // 결정을 기다리는 동안 두 의견을 먼저 보여준다
      const claude = this.adapters.claude;
      const ops = task.consult.opinions as Record<AgentId, Opinion>;
      const r = await this.run(claude, claude.opinionArgs(decidePrompt(task.prompt, ops), task.repo), task.repo, log);
      addUsage(task.usage, r.usage);
      if (task.status !== 'consulting') return;
      const d = r.error ? null : parseDecision(r.finalText);
      if (d) task.consult.decision = d;
      else task.consult.error = `결정을 받지 못했습니다: ${r.error ?? '결정 JSON을 읽지 못함'}`;
    } else if (rule !== 'manual') {
      task.consult.decision = rule;
    }
    this.publish(task);
  }
}
