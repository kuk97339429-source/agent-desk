import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { AgentEvent, AgentId, AgentUsage, Usage } from '../shared/types';

export type Outcome =
  | { status: 'done' }
  | { status: 'cancelled' }
  | { status: 'interrupted' }
  | { status: 'failed'; message: string }
  | { status: 'limited'; message: string; resetHint?: string };

export interface ParsedLine {
  events: AgentEvent[];
  sessionId?: string;
  usageDelta?: Usage;
  outcome?: Outcome;
  finalText?: string;
  /** 구독 한도 사용률(Claude rate_limit_event) */
  usageInfo?: AgentUsage;
  /** 실제로 쓰는 모델(Claude init 줄) */
  model?: string;
  /** 즉시 프로세스를 끝내야 함(추가 요금 구간 진입 등, 설계 14절) */
  halt?: boolean;
}

export interface Adapter {
  id: AgentId;
  /** 실행 파일이 있는지. 없으면 worktree를 만들기 전에 작업을 막는다(설계 4절) */
  isAvailable(): boolean;
  command(): string;
  /** model이 비어 있으면 모델 인자를 넣지 않는다(기본 설정) */
  runArgs(prompt: string, cwd: string, model?: string): string[];
  resumeArgs(sessionId: string, cwd: string, model?: string): string[];
  opinionArgs(prompt: string, repo: string): string[];
  parseLine(line: string): ParsedLine;
  /** 출력에 모델이 없을 때, 끝난 뒤 세션 기록에서 실제 모델을 찾는다(Codex) */
  modelOfSession?(sessionId: string): string | undefined;
}

export const RESUME_PROMPT = '이어서 진행해줘';

// shell 없이 실행하므로 Windows에서는 .exe만 실행할 수 있다(.cmd는 제외)
export function onPath(name: string, pathEnv = process.env.PATH ?? ''): boolean {
  const file = process.platform === 'win32' ? `${name}.exe` : name;
  return pathEnv
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => existsSync(join(dir, file)));
}

// '-'로 시작하는 지시문이 CLI 옵션으로 해석되지 않게 앞에 공백을 붙인다
export function safePrompt(p: string): string {
  return p.startsWith('-') ? ` ${p}` : p;
}

export function tryJson(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
