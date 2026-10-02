import type { AgentEvent } from '../shared/types';
import { type Adapter, type Outcome, type ParsedLine, RESUME_PROMPT, onPath, safePrompt, tryJson } from './adapter';
import { detectLimit, resetHintFromEpoch } from './limit';
import { claudeUsageFromEvent } from './quota';

// 작업 실행에는 사용량 상한을 넣지 않는다(사용자 결정, 설계 14절). 의견 요청만 내부 상한으로 폭주를 막는다
function common(mode: 'acceptEdits' | 'plan', budgetUsd?: number): string[] {
  return [
    '--output-format', 'stream-json', '--verbose',
    '--permission-mode', mode,
    ...(budgetUsd !== undefined ? ['--max-budget-usd', String(budgetUsd)] : []),
  ];
}

// 설계 16절: 작업 실행은 글을 조각 단위로 받아 실시간으로 보여 준다. 의견 요청은 결과만 쓰므로 넣지 않는다
const PARTIAL = '--include-partial-messages';

const modelArgs = (model?: string) => (model ? ['--model', model] : []);

function summarize(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  const v = o.file_path ?? o.command ?? o.pattern ?? o.path ?? o.url;
  return typeof v === 'string' ? v : JSON.stringify(o).slice(0, 120);
}

function resultOutcome(obj: Record<string, unknown>, text: string): Outcome {
  const subtype = String(obj.subtype ?? '');
  if (subtype.includes('budget')) return { status: 'limited', message: '사용량 상한 도달' };
  if (!obj.is_error && subtype === 'success') return { status: 'done' };
  const lim = detectLimit(text);
  return lim.limited
    ? { status: 'limited', message: text, resetHint: lim.resetHint }
    : { status: 'failed', message: text || subtype };
}

export function parseClaudeLine(line: string): ParsedLine {
  const obj = tryJson(line);
  if (!obj) return { events: [{ kind: 'raw', line }] };

  if (obj.type === 'system') {
    if (obj.subtype !== 'init' || typeof obj.session_id !== 'string') return { events: [] };
    return { events: [], sessionId: obj.session_id, model: typeof obj.model === 'string' ? obj.model : undefined };
  }

  if (obj.type === 'stream_event') {
    const delta = (obj.event as { delta?: { type?: unknown; text?: unknown } } | undefined)?.delta;
    return delta?.type === 'text_delta' && typeof delta.text === 'string' ? { events: [{ kind: 'delta', text: delta.text }] } : { events: [] };
  }

  if (obj.type === 'assistant') {
    const content = (obj.message as { content?: unknown[] } | undefined)?.content ?? [];
    const events: AgentEvent[] = [];
    for (const c of content as Record<string, unknown>[]) {
      if (c.type === 'text' && typeof c.text === 'string') events.push({ kind: 'text', text: c.text });
      if (c.type === 'tool_use') events.push({ kind: 'tool', name: String(c.name), detail: summarize(c.input) });
    }
    return { events };
  }

  if (obj.type === 'rate_limit_event') {
    // 구독 한도 상태를 알려주는 공식 필드(docs/cli-notes.md)
    const info = (obj.rate_limit_info ?? {}) as Record<string, unknown>;
    const usageInfo = claudeUsageFromEvent(obj, new Date().toISOString()) ?? undefined;
    // 설계 14절: 추가 요금 구간에 들어가면 agent-desk는 진행하지 않고 사용자가 직접 정하게 한다
    if (info.isUsingOverage === true) {
      return {
        events: [],
        usageInfo,
        halt: true,
        outcome: { status: 'limited', message: '추가 요금 구간에 들어가 멈췄습니다. 직접 세션을 열어 계속할지 정하세요.' },
      };
    }
    // allowed_warning 같은 경고 상태는 한도가 아니다. 거부(rejected)됐을 때만 한도로 본다
    if (info.status !== 'rejected') return usageInfo ? { events: [], usageInfo } : { events: [] };
    return {
      events: [],
      usageInfo,
      outcome: {
        status: 'limited',
        message: `사용량 한도 도달 (${String(info.rateLimitType ?? 'unknown')})`,
        resetHint: typeof info.resetsAt === 'number' ? resetHintFromEpoch(info.resetsAt) : undefined,
      },
    };
  }

  if (obj.type === 'result') {
    const text = typeof obj.result === 'string' ? obj.result : '';
    const result: ParsedLine = { events: [], outcome: resultOutcome(obj, text), finalText: text };
    if (typeof obj.session_id === 'string') result.sessionId = obj.session_id;
    if (typeof obj.total_cost_usd === 'number') result.usageDelta = { costUsd: obj.total_cost_usd };
    return result;
  }

  return { events: [] };
}

export const claudeAdapter: Adapter = {
  id: 'claude',
  isAvailable: () => onPath('claude'),
  command: () => 'claude',
  runArgs: (prompt, _cwd, model) => ['-p', safePrompt(prompt), ...common('acceptEdits'), PARTIAL, ...modelArgs(model)],
  resumeArgs: (sessionId, _cwd, model, message) => [
    '-p', safePrompt(message ?? RESUME_PROMPT), '--resume', sessionId, ...common('acceptEdits'), PARTIAL, ...modelArgs(model),
  ],
  opinionArgs: (prompt) => ['-p', safePrompt(prompt), ...common('plan', 0.3)],
  parseLine: parseClaudeLine,
};
