// 각 사용자 PC의 로그인 정보에서 요금제·사용률·모델만 골라 읽는다 (docs/design.md 13절).
// 이메일·이름·계정 ID·토큰은 읽어도 돌려주지 않고, ~/.codex/auth.json은 열지 않는다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentUsage, ModelOption, UsageWindow } from '../shared/types';
import { findFiles, parseJson, tailLines } from './logfiles';

const DEFAULT: ModelOption = { value: '', label: '기본 설정' };
const CLAUDE_BASE: ModelOption[] = [
  DEFAULT,
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' },
];

const CLAUDE_PLAN: Record<string, string> = { claude_pro: 'Claude Pro', claude_max: 'Claude Max' };
const CODEX_PLAN: Record<string, string> = { free: 'ChatGPT 무료', plus: 'ChatGPT Plus', pro: 'ChatGPT Pro', team: 'ChatGPT Team' };

function readJsonFile(file: string): Record<string, unknown> | null {
  try {
    return existsSync(file) ? parseJson(readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
}

export interface ClaudeAccount {
  plan: string | null;
  usage: AgentUsage | null;
  models: ModelOption[];
  /** 한도를 넘으면 유료로 계속 쓰는 설정(설계 14절). null이면 확인 불가 */
  extraUsage: boolean | null;
}

export function readClaudeAccount(claudeJson: string): ClaudeAccount {
  const o = readJsonFile(claudeJson);
  if (!o) return { plan: null, usage: null, models: CLAUDE_BASE, extraUsage: null };

  const acct = o.oauthAccount as { organizationType?: unknown; hasExtraUsageEnabled?: unknown } | undefined;
  const extraUsage = typeof acct?.hasExtraUsageEnabled === 'boolean' ? acct.hasExtraUsageEnabled : null;
  const type = typeof acct?.organizationType === 'string' ? acct.organizationType : undefined;
  const plan = !acct ? 'API 키(종량제)' : type ? (CLAUDE_PLAN[type] ?? type) : null;

  let usage: AgentUsage | null = null;
  const cache = o.cachedUsageUtilization as { fetchedAtMs?: number; utilization?: Record<string, unknown> } | undefined;
  if (cache?.utilization) {
    const windows: UsageWindow[] = [];
    for (const [key, label] of [['five_hour', '5시간'], ['seven_day', '7일']] as const) {
      const w = cache.utilization[key] as { utilization?: number; resets_at?: string } | null | undefined;
      if (w && typeof w.utilization === 'number') {
        windows.push({ label, percent: Math.round(w.utilization), resetsAt: w.resets_at ? new Date(w.resets_at).toISOString() : undefined });
      }
    }
    if (windows.length) usage = { agent: 'claude', windows, checkedAt: new Date(cache.fetchedAtMs ?? Date.now()).toISOString() };
  }

  const extra = Array.isArray(o.additionalModelOptionsCache) ? (o.additionalModelOptionsCache as { value?: unknown; label?: unknown }[]) : [];
  const models = [
    ...CLAUDE_BASE,
    ...extra
      .filter((m) => typeof m.value === 'string' && !CLAUDE_BASE.some((b) => b.value === m.value))
      .map((m) => ({ value: m.value as string, label: typeof m.label === 'string' ? m.label : (m.value as string) })),
  ];
  return { plan, usage, models, extraUsage };
}

export interface CodexAccount {
  plan: string | null;
  models: ModelOption[];
  /** 크레딧이 있어 한도 뒤에도 계속 쓸 수 있는지. null이면 확인 불가 */
  extraUsage: boolean | null;
}

export function readCodexAccount(codexHome: string): CodexAccount {
  let plan: string | null = null;
  let extraUsage: boolean | null = null;
  const latest = findFiles(join(codexHome, 'sessions'), /^rollout-.*\.jsonl$/)[0];
  if (latest) {
    const lines = tailLines(latest.file);
    for (let i = lines.length - 1; i >= 0 && !plan; i--) {
      const p = parseJson(lines[i])?.payload as
        | { type?: string; rate_limits?: { plan_type?: unknown; credits?: { has_credits?: unknown } | null } }
        | undefined;
      const rl = p?.type === 'token_count' ? p.rate_limits : undefined;
      if (typeof rl?.plan_type === 'string') {
        plan = CODEX_PLAN[rl.plan_type] ?? rl.plan_type;
        extraUsage = rl.credits?.has_credits === true;
      }
    }
  }
  const cache = readJsonFile(join(codexHome, 'models_cache.json'));
  const list = Array.isArray(cache?.models) ? (cache.models as { slug?: unknown; display_name?: unknown; visibility?: unknown }[]) : [];
  const models = [
    DEFAULT,
    ...list
      .filter((m) => m.visibility === 'list' && typeof m.slug === 'string')
      .map((m) => ({ value: m.slug as string, label: typeof m.display_name === 'string' ? m.display_name : (m.slug as string) })),
  ];
  return { plan, models, extraUsage };
}

/** agent-desk가 실행한 Codex 작업의 실제 모델: 세션 ID가 이름에 든 rollout의 turn_context */
export function codexModelOfSession(codexHome: string, sessionId: string): string | undefined {
  const hit = findFiles(join(codexHome, 'sessions'), /^rollout-.*\.jsonl$/).find((f) => f.file.includes(sessionId));
  if (!hit) return undefined;
  for (const line of tailLines(hit.file, 1024 * 1024)) {
    const o = parseJson(line);
    const model = o?.type === 'turn_context' ? (o.payload as { model?: unknown } | undefined)?.model : undefined;
    if (typeof model === 'string') return model;
  }
  return undefined;
}
