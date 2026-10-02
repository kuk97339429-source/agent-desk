// 다른 곳에서 연 Claude·Codex 세션을 읽기 전용으로 모은다 (docs/design.md 10절).
// 공개된 형식이 아니라서, 읽지 못한 파일은 그 세션만 건너뛴다.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ExternalSession } from '../shared/types';
import { findFiles, firstLine, parseJson, tailLines } from './logfiles';

const isAgentDeskTask = (cwd: string) => /[\\/]\.tm-worktrees[\\/]/.test(cwd);
const DAY = 24 * 3_600_000;
const STALE = 10 * 60_000;
const MAX_CODEX = 10;

const WHERE: Record<string, string> = {
  'claude-desktop': 'Claude 데스크톱',
  'claude-vscode': 'VS Code',
  cli: '터미널',
};

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // 살아 있지만 권한이 없음
  }
}

function textOf(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const texts = content
    .filter((c) => c && (c.type === 'text' || c.type === 'output_text') && typeof c.text === 'string')
    .map((c) => c.text as string);
  return texts.length ? texts[texts.length - 1] : undefined;
}

function lastClaudeMessage(claudeHome: string, sessionId: string): string | undefined {
  const projects = join(claudeHome, 'projects');
  if (!existsSync(projects)) return undefined;
  for (const dir of readdirSync(projects)) {
    const f = join(projects, dir, `${sessionId}.jsonl`);
    if (!existsSync(f)) continue;
    // 끝부분이 스크린샷 같은 큰 도구 결과로 채워져 있을 수 있어 범위를 넓혀 가며 찾는다
    for (const bytes of [64 * 1024, 1024 * 1024, 4 * 1024 * 1024]) {
      const lines = tailLines(f, bytes);
      for (let i = lines.length - 1; i >= 0; i--) {
        const o = parseJson(lines[i]);
        if (o?.type !== 'assistant') continue;
        const t = textOf((o.message as { content?: unknown } | undefined)?.content);
        if (t) return t;
      }
    }
    return undefined;
  }
  return undefined;
}

export function readClaudeSessions(claudeHome: string, isAlive: (pid: number) => boolean = isPidAlive): ExternalSession[] | null {
  const dir = join(claudeHome, 'sessions');
  if (!existsSync(dir)) return null;
  const out: ExternalSession[] = [];
  for (const name of readdirSync(dir)) {
    if (!/^\d+\.json$/.test(name)) continue; // .key 파일은 열지 않는다
    try {
      const r = parseJson(readFileSync(join(dir, name), 'utf8'));
      if (!r || typeof r.pid !== 'number' || typeof r.sessionId !== 'string') continue;
      const cwd = String(r.cwd ?? '');
      if (isAgentDeskTask(cwd) || !isAlive(r.pid)) continue;
      out.push({
        source: 'claude',
        id: r.sessionId,
        name: typeof r.name === 'string' && r.name ? r.name : basename(cwd),
        cwd,
        where: WHERE[String(r.entrypoint)] ?? String(r.entrypoint ?? 'Claude'),
        running: r.status === 'busy',
        updatedAt: new Date(typeof r.updatedAt === 'number' ? r.updatedAt : Date.now()).toISOString(),
        lastMessage: lastClaudeMessage(claudeHome, r.sessionId),
      });
    } catch {
      // 읽지 못한 등록부는 건너뛴다
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function codexNames(codexHome: string): Map<string, string> {
  const names = new Map<string, string>();
  const f = join(codexHome, 'session_index.jsonl');
  if (!existsSync(f)) return names;
  for (const line of tailLines(f, 512 * 1024)) {
    const o = parseJson(line);
    if (o && typeof o.id === 'string' && typeof o.thread_name === 'string') names.set(o.id, o.thread_name);
  }
  return names;
}

// session_meta 첫 줄은 지시문이 통째로 들어 있어 수십 KB가 넘는다. 앞부분만 읽으면 JSON이 잘리므로
// 필요한 두 값만 앞부분에서 꺼낸다
function codexMeta(head: string): { id?: string; cwd: string } {
  const id = head.match(/"id":"([^"]+)"/)?.[1];
  const rawCwd = head.match(/"cwd":"((?:[^"\\]|\\.)*)"/)?.[1];
  let cwd = '';
  try {
    cwd = rawCwd ? (JSON.parse(`"${rawCwd}"`) as string) : '';
  } catch {
    cwd = rawCwd ?? '';
  }
  return { id, cwd };
}

export function readCodexSessions(codexHome: string, now = Date.now()): ExternalSession[] | null {
  const dir = join(codexHome, 'sessions');
  if (!existsSync(dir)) return null;
  const names = codexNames(codexHome);
  const out: ExternalSession[] = [];
  for (const { file, mtimeMs } of findFiles(dir, /^rollout-.*\.jsonl$/)) {
    if (now - mtimeMs > DAY || out.length >= MAX_CODEX) break; // 최신순이라 여기서 끝
    try {
      const { id, cwd } = codexMeta(firstLine(file));
      if (!id || isAgentDeskTask(cwd)) continue;
      let started = -1;
      let completed = -1;
      let lastMessage: string | undefined;
      tailLines(file).forEach((line, i) => {
        const p = parseJson(line)?.payload as Record<string, unknown> | undefined;
        if (p?.type === 'task_started') started = i;
        if (p?.type === 'task_complete') completed = i;
        if (p?.type === 'message' && p.role === 'assistant') lastMessage = textOf(p.content) ?? lastMessage;
      });
      out.push({
        source: 'codex',
        id,
        name: names.get(id) ?? basename(cwd),
        cwd,
        where: 'Codex',
        // ponytail: 비정상 종료한 세션을 진행 중으로 오래 보이지 않게 10분 무소식이면 대기로 본다
        running: started > completed && now - mtimeMs < STALE,
        updatedAt: new Date(mtimeMs).toISOString(),
        lastMessage,
      });
    } catch {
      // 읽지 못한 기록은 건너뛴다
    }
  }
  return out;
}
