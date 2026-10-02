import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeUsageFromEvent, newerUsage, readCodexUsage, windowLabel } from './quota';

describe('newerUsage', () => {
  const u = (checkedAt: string) => ({ agent: 'claude' as const, windows: [], checkedAt });
  it('확인 시각이 더 최근인 쪽, 한쪽이 없으면 있는 쪽', () => {
    expect(newerUsage(u('2026-10-02T10:00:00Z'), u('2026-10-02T11:00:00Z'))?.checkedAt).toBe('2026-10-02T11:00:00Z');
    expect(newerUsage(u('2026-10-02T12:00:00Z'), u('2026-10-02T11:00:00Z'))?.checkedAt).toBe('2026-10-02T12:00:00Z');
    expect(newerUsage(null, u('2026-10-02T11:00:00Z'))?.checkedAt).toBe('2026-10-02T11:00:00Z');
    expect(newerUsage(null, null)).toBeNull();
  });
});

const CHECKED = '2026-10-02T10:00:00.000Z';

describe('windowLabel', () => {
  it('분 단위 창 길이를 사람이 읽는 말로', () => {
    expect(windowLabel(300)).toBe('5시간');
    expect(windowLabel(10080)).toBe('7일');
    expect(windowLabel(43200)).toBe('30일');
    expect(windowLabel(90)).toBe('90분');
  });
});

describe('claudeUsageFromEvent', () => {
  it('rate_limit_event의 5시간·7일 사용률을 %로', () => {
    const ev = {
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        unifiedWindows: { five_hour: { utilization: 0.56, resetsAt: 1790938800 }, seven_day: { utilization: 0.1234, resetsAt: 1791032400 } },
      },
    };
    expect(claudeUsageFromEvent(ev, CHECKED)).toEqual({
      agent: 'claude',
      checkedAt: CHECKED,
      windows: [
        { label: '5시간', percent: 56, resetsAt: new Date(1790938800 * 1000).toISOString() },
        { label: '7일', percent: 12, resetsAt: new Date(1791032400 * 1000).toISOString() },
      ],
    });
  });

  it('창 정보가 없으면 null', () => {
    expect(claudeUsageFromEvent({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }, CHECKED)).toBeNull();
    expect(claudeUsageFromEvent({ type: 'result' }, CHECKED)).toBeNull();
  });
});

describe('readCodexUsage', () => {
  function rollout(dir: string, name: string, lines: unknown[], mtimeSec: number) {
    const f = join(dir, name);
    writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    utimesSync(f, mtimeSec, mtimeSec);
  }

  it('가장 최근 rollout의 마지막 token_count rate_limits를 읽는다', () => {
    const home = mkdtempSync(join(tmpdir(), 'codexhome-'));
    const day = join(home, 'sessions', '2026', '10', '02');
    mkdirSync(day, { recursive: true });
    const tc = (pct: number) => ({
      type: 'event_msg',
      payload: { type: 'token_count', rate_limits: { primary: { used_percent: pct, window_minutes: 43200, resets_at: 1793338723 }, secondary: null } },
    });
    rollout(day, 'rollout-old.jsonl', [tc(5)], 1000);
    rollout(day, 'rollout-new.jsonl', [tc(10), { type: 'event_msg', payload: { type: 'task_complete' } }, tc(14)], 2000);
    const u = readCodexUsage(home);
    expect(u?.windows).toEqual([{ label: '30일', percent: 14, resetsAt: new Date(1793338723 * 1000).toISOString() }]);
    expect(u?.agent).toBe('codex');
  });

  it('sessions 폴더가 없으면 null', () => {
    expect(readCodexUsage(mkdtempSync(join(tmpdir(), 'codexhome-')))).toBeNull();
  });
});
