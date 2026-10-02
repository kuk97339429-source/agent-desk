import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeAdapter as a } from './claude';
import { resetHintFromEpoch } from './limit';

describe('claudeAdapter args', () => {
  it('runArgs: 지시문을 -p 바로 뒤 한 원소로, 고정 옵션만 붙이고 사용량 상한은 넣지 않는다', () => {
    expect(a.runArgs('고쳐줘', 'C:/wt')).toEqual([
      '-p', '고쳐줘',
      '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'acceptEdits',
    ]);
  });

  it('모델을 고르면 --model, 재개에도 같은 모델', () => {
    expect(a.runArgs('고쳐줘', 'C:/wt', 'opus').slice(-2)).toEqual(['--model', 'opus']);
    expect(a.resumeArgs('sid-1', 'C:/wt', 'opus').slice(-2)).toEqual(['--model', 'opus']);
    expect(a.runArgs('고쳐줘', 'C:/wt', '')).not.toContain('--model');
  });

  it('init 줄에서 실제 모델을 읽는다', () => {
    expect(a.parseLine('{"type":"system","subtype":"init","session_id":"abc","model":"claude-sonnet-5-5"}').model).toBe('claude-sonnet-5-5');
  });

  it("'-'로 시작하는 지시문은 앞에 공백을 붙인다", () => {
    expect(a.runArgs('-rf 지워', 'C:/wt')[1]).toBe(' -rf 지워');
  });

  it('resumeArgs: --resume 세션과 재개 문구', () => {
    expect(a.resumeArgs('sid-1', 'C:/wt')).toEqual([
      '-p', '이어서 진행해줘', '--resume', 'sid-1',
      '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'acceptEdits',
    ]);
  });

  it('opinionArgs: plan 모드, 상한 0.3', () => {
    const args = a.opinionArgs('누가?', 'C:/repo');
    expect(args).toContain('plan');
    expect(args.slice(-2)).toEqual(['--max-budget-usd', '0.3']);
  });
});

describe('claudeAdapter.parseLine', () => {
  it('init 줄에서 세션 ID', () => {
    expect(a.parseLine('{"type":"system","subtype":"init","session_id":"abc"}').sessionId).toBe('abc');
  });

  it('assistant 텍스트와 도구 사용을 이벤트로', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '읽어볼게요' },
          { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } },
        ],
      },
    });
    expect(a.parseLine(line).events).toEqual([
      { kind: 'text', text: '읽어볼게요' },
      { kind: 'tool', name: 'Read', detail: 'a.ts' },
    ]);
  });

  it('성공 result: done, 비용, 최종 텍스트', () => {
    const p = a.parseLine('{"type":"result","subtype":"success","is_error":false,"result":"끝","total_cost_usd":0.12,"session_id":"abc"}');
    expect(p.outcome).toEqual({ status: 'done' });
    expect(p.usageDelta).toEqual({ costUsd: 0.12 });
    expect(p.finalText).toBe('끝');
  });

  it('subtype에 budget이 들어가면 limited(사용량 상한 도달)', () => {
    const p = a.parseLine('{"type":"result","subtype":"error_max_budget_usd","is_error":true,"total_cost_usd":0.5}');
    expect(p.outcome).toEqual({ status: 'limited', message: '사용량 상한 도달' });
  });

  it('한도 문구 result는 limited, 나머지 오류는 failed', () => {
    const lim = a.parseLine('{"type":"result","subtype":"success","is_error":true,"result":"Claude AI usage limit reached|1759400000"}');
    expect(lim.outcome?.status).toBe('limited');
    const bad = a.parseLine('{"type":"result","subtype":"error_during_execution","is_error":true,"result":"crash"}');
    expect(bad.outcome).toEqual({ status: 'failed', message: 'crash' });
  });

  it('rate_limit_event가 allowed면 결과는 정하지 않고 사용률만 돌려준다', () => {
    const p = a.parseLine(
      '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1790938800,"rateLimitType":"five_hour","unifiedWindows":{"five_hour":{"utilization":0.56,"resetsAt":1790938800}}}}',
    );
    expect(p.outcome).toBeUndefined();
    expect(p.usageInfo?.windows).toEqual([{ label: '5시간', percent: 56, resetsAt: new Date(1790938800 * 1000).toISOString() }]);
  });

  it('rate_limit_event가 allowed_warning(한도 근접 경고)이면 결과를 정하지 않는다', () => {
    const p = a.parseLine('{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1790938800,"rateLimitType":"five_hour"}}');
    expect(p.outcome).toBeUndefined();
  });

  it('추가 요금 구간에 들어가면(isUsingOverage) 즉시 멈추라는 신호와 limited', () => {
    const p = a.parseLine('{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","isUsingOverage":true,"rateLimitType":"five_hour"}}');
    expect(p.halt).toBe(true);
    expect(p.outcome).toEqual({ status: 'limited', message: '추가 요금 구간에 들어가 멈췄습니다. 직접 세션을 열어 계속할지 정하세요.' });
  });

  it('rate_limit_event가 rejected면 limited와 초기화 시각', () => {
    const p = a.parseLine('{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1790938800,"rateLimitType":"five_hour"}}');
    expect(p.outcome).toEqual({
      status: 'limited',
      message: '사용량 한도 도달 (five_hour)',
      resetHint: resetHintFromEpoch(1790938800),
    });
  });

  it('JSON이 아닌 줄은 raw 이벤트', () => {
    expect(a.parseLine('Warning: something').events).toEqual([{ kind: 'raw', line: 'Warning: something' }]);
  });

  it('실제 샘플(fixtures/claude-run.jsonl)에서 세션 ID와 done을 얻는다', () => {
    const f = join(__dirname, '../../fixtures/claude-run.jsonl');
    if (!existsSync(f)) return;
    const parsed = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => a.parseLine(l));
    expect(parsed.some((p) => p.sessionId)).toBe(true);
    expect(parsed.some((p) => p.outcome?.status === 'done')).toBe(true);
    expect(parsed.flatMap((p) => p.events).some((e) => e.kind === 'raw')).toBe(false);
  });

  it('실제 샘플(fixtures/claude-budget.jsonl)은 limited로 끝난다', () => {
    const f = join(__dirname, '../../fixtures/claude-budget.jsonl');
    if (!existsSync(f)) return;
    const outcomes = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => a.parseLine(l).outcome).filter(Boolean);
    expect(outcomes.at(-1)).toEqual({ status: 'limited', message: '사용량 상한 도달' });
  });
});
