// 구독 사용률 보호선 (docs/design.md 14절). 화면과 메인 프로세스가 같은 규칙을 쓴다
import type { AgentId, AgentUsage } from './types';

export const WARN_PERCENT = 80;
export const BLOCK_PERCENT = 90;

export interface GuardResult {
  level: 'ok' | 'warn' | 'block';
  percent?: number;
  window?: string;
}

/** 사용률 창 중 가장 높은 값으로 판단한다. 사용률을 모르면 검사하지 않는다 */
export function usageGuard(usage: AgentUsage | undefined): GuardResult {
  const top = usage?.windows.reduce((a, b) => (b.percent > a.percent ? b : a), usage.windows[0]);
  if (!top) return { level: 'ok' };
  const level = top.percent >= BLOCK_PERCENT ? 'block' : top.percent >= WARN_PERCENT ? 'warn' : 'ok';
  return { level, percent: top.percent, window: top.label };
}

/** 상의 모드에서 쓸 수 없는(90% 이상) AI */
export function consultBlocked(usage: Partial<Record<AgentId, AgentUsage>>): AgentId[] {
  return (['claude', 'codex'] as const).filter((a) => usageGuard(usage[a]).level === 'block');
}
