import { describe, expect, it } from 'vitest';
import { detectLimit, resetHintFromEpoch } from './limit';

describe('detectLimit', () => {
  it('Claude 에포크 형식에서 초기화 시각을 HH:MM 이후로 만든다', () => {
    const r = detectLimit('Claude AI usage limit reached|1759400000');
    expect(r.limited).toBe(true);
    expect(r.resetHint).toMatch(/^\d{2}:\d{2} 이후$/);
  });

  it('resets 문구를 그대로 힌트로 쓴다', () => {
    const r = detectLimit('5-hour limit reached ∙ resets 3pm');
    expect(r).toEqual({ limited: true, resetHint: 'resets 3pm' });
  });

  it('Codex try again 문구를 감지한다', () => {
    const r = detectLimit("You've hit your usage limit. Try again in 2 days.");
    expect(r.limited).toBe(true);
    expect(r.resetHint).toBe('Try again in 2 days');
  });

  it('429와 rate limit도 한도로 본다', () => {
    expect(detectLimit('HTTP 429 Too Many Requests').limited).toBe(true);
    expect(detectLimit('rate limit exceeded').limited).toBe(true);
  });

  it('일반 오류는 한도가 아니다', () => {
    expect(detectLimit('SyntaxError: unexpected token').limited).toBe(false);
  });
});

describe('resetHintFromEpoch', () => {
  it('초 단위 에포크를 로컬 HH:MM 이후로', () => {
    const d = new Date(1790938800 * 1000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    expect(resetHintFromEpoch(1790938800)).toBe(`${hh}:${mm} 이후`);
  });
});
