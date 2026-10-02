import type { AgentEvent, AgentId, Task } from '../../shared/types';
import { progressMarks } from '../../shared/progress';

// IPC로 던진 오류에는 Electron이 "Error invoking remote method 'x': Error: " 접두어를 붙인다
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
}

export function agoText(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const sec = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (sec < 10) return '방금';
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return `${Math.floor(sec / 3600)}시간 전`;
}

export function resetText(resetsAt: string | undefined, now = Date.now()): string {
  if (!resetsAt) return '';
  const d = new Date(resetsAt);
  if (d.getTime() - now < 24 * 3_600_000) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 초기화`;
  }
  return `${d.getMonth() + 1}월 ${d.getDate()}일 초기화`;
}

export function elapsedText(createdAt: string, endedAt?: string, now = Date.now()): string {
  const sec = Math.max(0, Math.floor(((endedAt ? Date.parse(endedAt) : now) - Date.parse(createdAt)) / 1000));
  if (sec < 60) return `${sec}초`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분`;
  return `${Math.floor(min / 60)}시간 ${min % 60}분`;
}

const RECENT_MS = 10 * 60_000;
const isLive = (t: Task) => t.status === 'running' || t.status === 'consulting';

/** 진행 현황에 띄울 작업(설계 16절): 실행 중·상의 중, 그다음 10분 안에 끝난 작업 */
export function boardTasks(tasks: Task[], now = Date.now()): Task[] {
  const recent = tasks.filter((t) => !isLive(t) && t.endedAt && now - Date.parse(t.endedAt) < RECENT_MS);
  return [...tasks.filter(isLive), ...recent];
}

export type Queued = [id: string, e: AgentEvent];

/** 쓰는 중인 글: 조각은 이어 붙이고, 완성된 글(text)이 오면 비운다. 바뀐 게 없으면 같은 객체 */
export function applyDrafts(prev: Record<string, string>, queue: Queued[]): Record<string, string> {
  let next = prev;
  for (const [id, e] of queue) {
    if (e.kind === 'delta') next = { ...next, [id]: (next[id] ?? '') + e.text };
    else if (e.kind === 'text' && id in next) {
      const { [id]: _, ...rest } = next;
      next = rest;
    }
  }
  return next;
}

/** 기록: 조각을 뺀 이벤트를 작업별로 붙이고 최근 max개만 남긴다(메모리가 끝없이 늘지 않게). 바뀐 게 없으면 같은 객체 */
export function applyEvents(prev: Record<string, AgentEvent[]>, queue: Queued[], max: number): Record<string, AgentEvent[]> {
  const added: Record<string, AgentEvent[]> = {};
  for (const [id, e] of queue) if (e.kind !== 'delta') (added[id] ??= []).push(e);
  const ids = Object.keys(added);
  if (ids.length === 0) return prev;
  const next = { ...prev };
  for (const id of ids) next[id] = [...(prev[id] ?? []), ...added[id]].slice(-max);
  return next;
}

/** 작업 폴더의 결과를 커밋하고 원본 저장소에 합치는 명령(사용자가 직접 실행) */
export function mergeCommands(task: Task): string {
  // 커밋 메시지는 따옴표 안에 들어가므로 따옴표와 줄바꿈을 뺀다
  const msg = task.prompt.split('\n')[0].replace(/["`$\\]/g, "'").slice(0, 60);
  return [
    `git -C "${task.worktree}" add -A`,
    `git -C "${task.worktree}" commit -m "agent-desk: ${msg}"`,
    `git -C "${task.repo}" merge ${task.branch}`,
  ].join('\n');
}

const ENDED_OK = new Set<Task['status']>(['done', 'limited', 'failed']);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/**
 * 보내기 전 참고값(설계 20절): 같은 AI로 끝난 최근 n개 작업(목록은 최신순)의 평균 시간과 사용량.
 * ponytail: 작업 한 건이 구독 한도의 몇 %를 썼는지는 알 수 없어(Claude는 실행 시작 때만 사용률을 줌) 시간·API 환산값으로 대신한다
 */
export function recentStats(tasks: Task[], agent: AgentId, n = 10) {
  const recent = tasks.filter((t) => t.agent === agent && ENDED_OK.has(t.status) && t.endedAt).slice(0, n);
  if (recent.length === 0) return null;
  const cost = avg(recent.flatMap((t) => (t.usage.costUsd !== undefined ? [t.usage.costUsd] : [])));
  const tokens = avg(recent.flatMap((t) => (t.usage.tokens !== undefined ? [t.usage.tokens] : [])));
  return {
    count: recent.length,
    avgMinutes: Math.round(avg(recent.map((t) => (Date.parse(t.endedAt!) - Date.parse(t.createdAt)) / 60000))!),
    avgCostUsd: cost === undefined ? undefined : Math.round(cost * 100) / 100,
    avgTokens: tokens === undefined ? undefined : Math.round(tokens),
  };
}

// ---- 설계 21절: 검토 중심 화면 ----

export type DiffLine = { kind: 'add' | 'del' | 'hunk' | 'ctx' | 'meta'; text: string };

/** diff 글을 줄 종류별로 나눈다. git 머리말(diff --git, index, ---, +++)은 뺀다 */
export function diffLines(text: string): DiffLine[] {
  const out: DiffLine[] = [];
  for (const line of text.split('\n')) {
    if (/^(diff --git |index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) )/.test(line)) continue;
    if (line.startsWith('\\ ')) out.push({ kind: 'meta', text: '(파일 끝에 줄바꿈 없음)' }); // git의 "\ No newline at end of file"
    else if (line.startsWith('@@')) out.push({ kind: 'hunk', text: line });
    else if (line.startsWith('+')) out.push({ kind: 'add', text: line });
    else if (line.startsWith('-')) out.push({ kind: 'del', text: line });
    else if (line.startsWith(' ')) out.push({ kind: 'ctx', text: line });
    else if (line) out.push({ kind: 'meta', text: line });
  }
  return out;
}

const awaitingPick = (t: Task) => t.status === 'consulting' && !!(t.consult?.decision || t.consult?.error);

/** 왼쪽 목록 묶음: 내가 볼 것(확인 필요) → 실행 중 → 검토할 결과 → 끝남. 빈 묶음은 뺀다 */
export function groupTasks(tasks: Task[]): { key: string; label: string; tasks: Task[] }[] {
  const groups = [
    { key: 'attention', label: '확인 필요', tasks: [] as Task[] },
    { key: 'running', label: '실행 중', tasks: [] as Task[] },
    { key: 'review', label: '검토할 결과', tasks: [] as Task[] },
    { key: 'ended', label: '끝남', tasks: [] as Task[] },
  ];
  for (const t of tasks) {
    const g =
      awaitingPick(t) || t.status === 'limited' || t.status === 'failed' || t.status === 'interrupted'
        ? 0
        : t.status === 'running' || t.status === 'consulting'
          ? 1
          : t.status === 'done' && t.worktree && t.changedFiles?.length
            ? 2
            : 3;
    groups[g].tasks.push(t);
  }
  return groups.filter((g) => g.tasks.length > 0);
}

/** 목록 줄 아래에 보일 한 줄: 지금 하는 일이나 내가 할 일 */
export function lastLine(t: Task): string {
  if (awaitingPick(t)) return '담당을 골라 주세요';
  switch (t.status) {
    case 'running':
      return t.activity?.lastAction ?? '시작하는 중';
    case 'consulting':
      return '두 AI의 의견을 받는 중';
    case 'limited':
      return t.resetHint ? `${t.resetHint} 이어서 하기` : '한도 초기화 뒤 이어서 하기';
    case 'failed':
    case 'interrupted':
      return t.error?.split('\n')[0] ?? '이어서 하거나 정리하세요';
    case 'done':
      return t.worktree && t.changedFiles?.length ? `바뀐 파일 ${t.changedFiles.length}개 검토` : '정리됨';
    default:
      return '';
  }
}

export type Step = { n: number; label?: string; state: 'done' | 'active' | 'todo' };

/** AI가 알려 준 [진행 n/N] 표시들로 단계 목록을 만든다. 지금 단계 앞은 끝남, 작업이 완료면 모두 끝남 */
export function stepList(events: AgentEvent[], status: Task['status']): Step[] {
  const labels = new Map<number, string | undefined>();
  let current = 0;
  let total = 0;
  for (const e of events) {
    if (e.kind !== 'text') continue;
    for (const m of progressMarks(e.text)) {
      if (m.label || !labels.has(m.step)) labels.set(m.step, m.label);
      current = m.step;
      total = m.total;
    }
  }
  return Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    const state = status === 'done' || n < current ? 'done' : n === current ? 'active' : 'todo';
    return { n, label: labels.get(n), state };
  });
}
