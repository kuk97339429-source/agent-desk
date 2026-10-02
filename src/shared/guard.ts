// 구독 사용률 보호선 (docs/design.md 14절). 화면과 메인 프로세스가 같은 규칙을 쓴다
import type { AgentId, AgentUsage, UsageWindow } from './types';

export const WARN_PERCENT = 80;
export const BLOCK_PERCENT = 90;

/** 이보다 오래된 사용률은 "실제는 더 높을 수 있음"으로 본다(설계 14절) */
export const STALE_MS = 30 * 60_000;

export interface GuardResult {
  level: 'ok' | 'warn' | 'block';
  percent?: number;
  window?: string;
  /** 사용률 값이 오래돼 실제보다 낮을 수 있음 */
  stale?: boolean;
}

/** 초기화 시각이 지난 창의 값은 이미 의미가 없다 */
export const isReset = (w: UsageWindow, now = Date.now()) => !!w.resetsAt && Date.parse(w.resetsAt) <= now;
export const isStale = (u: AgentUsage, now = Date.now()) => now - Date.parse(u.checkedAt) > STALE_MS;

/** 아직 유효한 사용률 창 중 가장 높은 값으로 판단한다. 사용률을 모르면 검사하지 않는다 */
export function usageGuard(usage: AgentUsage | undefined, now = Date.now()): GuardResult {
  if (!usage) return { level: 'ok' };
  const live = usage.windows.filter((w) => !isReset(w, now));
  const top = live.reduce<UsageWindow | undefined>((a, b) => (!a || b.percent > a.percent ? b : a), undefined);
  if (!top) return { level: 'ok' };
  const level = top.percent >= BLOCK_PERCENT ? 'block' : top.percent >= WARN_PERCENT ? 'warn' : 'ok';
  return { level, percent: top.percent, window: top.label, stale: isStale(usage, now) };
}

/** 상의 모드에서 쓸 수 없는(90% 이상) AI */
export function consultBlocked(usage: Partial<Record<AgentId, AgentUsage>>): AgentId[] {
  return (['claude', 'codex'] as const).filter((a) => usageGuard(usage[a]).level === 'block');
}
