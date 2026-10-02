export type AgentId = 'claude' | 'codex';

export type TaskStatus =
  | 'consulting'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'limited'
  | 'interrupted';

export type AgentEvent =
  | { kind: 'text'; text: string }
  /** 쓰는 중인 글 조각(설계 16절). 완성된 글이 text로 다시 오므로 지난 기록에는 넣지 않는다 */
  | { kind: 'delta'; text: string }
  /** 사용자가 보낸 이어서 지시(설계 18절) */
  | { kind: 'user'; text: string }
  | { kind: 'tool'; name: string; detail: string }
  | { kind: 'error'; message: string }
  | { kind: 'raw'; line: string };

export interface Usage {
  costUsd?: number;
  tokens?: number;
}

export interface Opinion {
  approach: string;
  difficulty: number;
  fit: 'me' | 'other' | 'either';
  reason: string;
}

export type OpinionResult = Opinion | { error: string };

export interface Decision {
  assignee: AgentId;
  reason: string;
  plan: string;
}

export interface Task {
  id: string;
  repo: string;
  prompt: string;
  agent: AgentId | null;
  status: TaskStatus;
  worktree?: string;
  branch?: string;
  sessionId?: string;
  usage: Usage;
  /** 사용자가 고른 AI별 모델(없으면 기본 설정) */
  models?: Partial<Record<AgentId, string>>;
  /** 실제로 쓴 모델 */
  model?: string;
  /** 지시문 끝에 AI 진행 표시 요청을 붙일지(설계 15절 B) */
  progressHint?: boolean;
  /** 실행 중 활동 정보(설계 15절 A). progress는 AI가 스스로 알려 준 값 */
  activity?: { steps: number; lastAction?: string; lastAt?: string; progress?: { step: number; total: number; label?: string } };
  changedFiles?: string[];
  diffStat?: string;
  error?: string;
  resetHint?: string;
  consult?: { opinions: Partial<Record<AgentId, OpinionResult>>; decision?: Decision; error?: string };
  createdAt: string;
  endedAt?: string;
}

/** 다른 곳(Claude 데스크톱·VS Code·Codex 앱)에서 연 세션. 읽기 전용 */
export interface ExternalSession {
  source: AgentId;
  id: string;
  name: string;
  cwd: string;
  where: string;
  running: boolean;
  updatedAt: string;
  lastMessage?: string;
}

export interface UsageWindow {
  label: string;
  percent: number;
  resetsAt?: string;
}

export interface AgentUsage {
  agent: AgentId;
  windows: UsageWindow[];
  checkedAt: string;
}

/** 모델 선택지. value가 ''이면 "기본 설정"(인자를 넣지 않음) */
export interface ModelOption {
  value: string;
  label: string;
}

export interface Overview {
  /** null이면 그 도구의 세션 정보 폴더를 찾지 못한 것 */
  external: Record<AgentId, ExternalSession[] | null>;
  usage: AgentUsage[];
  /** 요금제(null이면 확인 불가)와 고를 수 있는 모델 */
  accounts: Record<AgentId, { plan: string | null; models: ModelOption[]; extraUsage: boolean | null }>;
}

export interface NewTaskInput {
  repo: string;
  prompt: string;
  agent: AgentId | 'consult';
  models?: Partial<Record<AgentId, string>>;
  progressHint?: boolean;
}

export interface DeskApi {
  listTasks(): Promise<Task[]>;
  getEvents(id: string): Promise<AgentEvent[]>;
  createTask(input: NewTaskInput): Promise<Task>;
  confirmTask(id: string, agent: AgentId): Promise<void>;
  cancelTask(id: string): Promise<void>;
  /** message가 있으면 같은 세션에 이어서 지시(설계 18절), 없으면 재개 문구로 이어서 하기 */
  resumeTask(id: string, message?: string): Promise<void>;
  /** discard가 아니면 커밋하지 않은 변경이 있을 때 거부한다 */
  cleanupTask(id: string, discard?: boolean): Promise<void>;
  openFolder(id: string): Promise<void>;
  pickRepo(): Promise<string | null>;
  checkRepo(repo: string): Promise<{ root: string | null; dirty: boolean }>;
  paidKeys(): Promise<string[]>;
  overview(): Promise<Overview>;
  /** 공식 도구를 새 터미널 창에서 직접 연다. sessionId가 있으면 그 세션을 이어서(설계 14절) */
  openSession(agent: AgentId, cwd: string, sessionId?: string): Promise<void>;
  onTaskUpdate(cb: (task: Task) => void): () => void;
  onTaskEvent(cb: (id: string, event: AgentEvent) => void): () => void;
}
