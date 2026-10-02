import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexModelOfSession, readClaudeAccount, readCodexAccount } from './account';

const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

describe('readClaudeAccount', () => {
  const file = (o: unknown) => {
    const f = join(mkdtempSync(join(tmpdir(), 'cj-')), '.claude.json');
    writeFileSync(f, JSON.stringify(o));
    return f;
  };

  it('요금제·사용률·추가 모델을 읽고 개인정보는 돌려주지 않는다', () => {
    const f = file({
      oauthAccount: { emailAddress: 'me@example.com', fullName: '홍길동', organizationType: 'claude_pro' },
      cachedUsageUtilization: {
        fetchedAtMs: 1790943419284,
        utilization: {
          five_hour: { utilization: 22, resets_at: '2026-10-02T16:40:00.285359+00:00' },
          seven_day: { utilization: 64, resets_at: '2026-10-03T13:00:00.285387+00:00' },
          seven_day_opus: null,
        },
      },
      additionalModelOptionsCache: [{ value: 'claude-fable-5-1[1m]', label: 'Fable' }],
    });
    const a = readClaudeAccount(f);
    expect(a.plan).toBe('Claude Pro');
    expect(a.usage).toEqual({
      agent: 'claude',
      checkedAt: new Date(1790943419284).toISOString(),
      windows: [
        { label: '5시간', percent: 22, resetsAt: '2026-10-02T16:40:00.285Z' },
        { label: '7일', percent: 64, resetsAt: '2026-10-03T13:00:00.285Z' },
      ],
    });
    expect(a.models.map((m) => m.value)).toEqual(['', 'sonnet', 'opus', 'haiku', 'claude-fable-5-1[1m]']);
    expect(JSON.stringify(a)).not.toContain('me@example.com');
    expect(JSON.stringify(a)).not.toContain('홍길동');
  });

  it('추가 사용량(추가 요금) 허용 여부', () => {
    expect(readClaudeAccount(file({ oauthAccount: { organizationType: 'claude_pro', hasExtraUsageEnabled: true } })).extraUsage).toBe(true);
    expect(readClaudeAccount(file({ oauthAccount: { organizationType: 'claude_pro', hasExtraUsageEnabled: false } })).extraUsage).toBe(false);
    expect(readClaudeAccount(file({})).extraUsage).toBeNull();
  });

  it('Max 요금제와 로그인 정보 없음(API 키)', () => {
    expect(readClaudeAccount(file({ oauthAccount: { organizationType: 'claude_max' } })).plan).toBe('Claude Max');
    expect(readClaudeAccount(file({})).plan).toBe('API 키(종량제)');
  });

  it('파일이 없거나 깨졌으면 확인 불가, 기본 모델 목록은 유지', () => {
    const a = readClaudeAccount(join(tmpdir(), 'no-such-claude.json'));
    expect(a.plan).toBeNull();
    expect(a.usage).toBeNull();
    expect(a.models.map((m) => m.value)).toEqual(['', 'sonnet', 'opus', 'haiku']);
  });
});

describe('readCodexAccount', () => {
  function home() {
    const h = mkdtempSync(join(tmpdir(), 'codexhome-'));
    const day = join(h, 'sessions', '2026', '10', '02');
    mkdirSync(day, { recursive: true });
    return { h, day };
  }

  it('최근 rollout의 plan_type과 목록 표시용 모델만', () => {
    const { h, day } = home();
    writeFileSync(
      join(day, 'rollout-x.jsonl'),
      jsonl([{ type: 'event_msg', payload: { type: 'token_count', rate_limits: { plan_type: 'free', primary: null } } }]),
    );
    writeFileSync(
      join(h, 'models_cache.json'),
      JSON.stringify({
        models: [
          { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list' },
          { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide' },
          { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' },
        ],
      }),
    );
    const a = readCodexAccount(h);
    expect(a.plan).toBe('ChatGPT 무료');
    expect(a.extraUsage).toBe(false);
    expect(a.models).toEqual([
      { value: '', label: '기본 설정' },
      { value: 'gpt-6-luna', label: 'GPT-6-Luna' },
      { value: 'gpt-5.5', label: 'GPT-5.5' },
    ]);
  });

  it('크레딧이 있으면 추가 사용 가능으로 본다', () => {
    const { h, day } = home();
    writeFileSync(
      join(day, 'rollout-c.jsonl'),
      jsonl([{ type: 'event_msg', payload: { type: 'token_count', rate_limits: { plan_type: 'plus', credits: { has_credits: true } } } }]),
    );
    expect(readCodexAccount(h)).toMatchObject({ plan: 'ChatGPT Plus', extraUsage: true });
  });

  it('기록이 없으면 확인 불가', () => {
    const { h } = home();
    expect(readCodexAccount(h)).toEqual({ plan: null, extraUsage: null, models: [{ value: '', label: '기본 설정' }] });
  });
});

describe('codexModelOfSession', () => {
  it('세션 ID가 이름에 든 rollout의 turn_context에서 모델을 읽는다', () => {
    const h = mkdtempSync(join(tmpdir(), 'codexhome-'));
    const day = join(h, 'sessions', '2026', '10', '02');
    mkdirSync(day, { recursive: true });
    const f = join(day, 'rollout-2026-10-02T14-54-10-01a0fb2d-aaaa.jsonl');
    writeFileSync(f, jsonl([{ type: 'session_meta', payload: { id: '01a0fb2d-aaaa' } }, { type: 'turn_context', payload: { model: 'gpt-6-luna', effort: 'medium' } }]));
    utimesSync(f, 1000, 1000);
    expect(codexModelOfSession(h, '01a0fb2d-aaaa')).toBe('gpt-6-luna');
    expect(codexModelOfSession(h, 'nope')).toBeUndefined();
  });
});
