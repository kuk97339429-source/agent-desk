import { join } from 'node:path';
import type { AgentUsage, UsageWindow } from '../shared/types';
import { findFiles, parseJson, tailLines } from './logfiles';

export function windowLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}일`;
  if (minutes % 60 === 0) return `${minutes / 60}시간`;
  return `${minutes}분`;
}

const iso = (sec: unknown) => (typeof sec === 'number' ? new Date(sec * 1000).toISOString() : undefined);

/** Claude rate_limit_event 줄 → 5시간·7일 사용률 (docs/design.md 11절) */
export function claudeUsageFromEvent(obj: Record<string, unknown>, checkedAt: string): AgentUsage | null {
  if (obj.type !== 'rate_limit_event') return null;
  const w = ((obj.rate_limit_info ?? {}) as Record<string, unknown>).unifiedWindows as
    | Record<string, { utilization?: number; resetsAt?: number }>
    | undefined;
  if (!w) return null;
  const windows: UsageWindow[] = [];
  for (const [key, label] of [['five_hour', '5시간'], ['seven_day', '7일']] as const) {
    const v = w[key];
    if (v && typeof v.utilization === 'number') {
      windows.push({ label, percent: Math.round(v.utilization * 100), resetsAt: iso(v.resetsAt) });
    }
  }
  return windows.length ? { agent: 'claude', windows, checkedAt } : null;
}

/** 같은 AI의 사용률이 두 군데서 오면(agent-desk 실행 기록, Claude 자체 캐시) 더 최근 것을 쓴다 */
export function newerUsage(a: AgentUsage | null, b: AgentUsage | null): AgentUsage | null {
  if (!a || !b) return a ?? b;
  return Date.parse(b.checkedAt) > Date.parse(a.checkedAt) ? b : a;
}

/** 가장 최근 Codex rollout의 마지막 token_count에서 한도 사용률을 읽는다 */
export function readCodexUsage(codexHome: string): AgentUsage | null {
  const latest = findFiles(join(codexHome, 'sessions'), /^rollout-.*\.jsonl$/)[0];
  if (!latest) return null;
  const lines = tailLines(latest.file);
  for (let i = lines.length - 1; i >= 0; i--) {
    const o = parseJson(lines[i]);
    const p = o?.payload as Record<string, unknown> | undefined;
    if (p?.type !== 'token_count' || !p.rate_limits) continue;
    const rl = p.rate_limits as Record<string, { used_percent?: number; window_minutes?: number; resets_at?: number } | null>;
    const windows: UsageWindow[] = [];
    for (const v of [rl.primary, rl.secondary]) {
      if (v && typeof v.used_percent === 'number' && typeof v.window_minutes === 'number') {
        windows.push({ label: windowLabel(v.window_minutes), percent: Math.round(v.used_percent), resetsAt: iso(v.resets_at) });
      }
    }
    if (windows.length) return { agent: 'codex', windows, checkedAt: new Date(latest.mtimeMs).toISOString() };
  }
  return null;
}
