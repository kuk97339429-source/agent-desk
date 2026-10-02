import { describe, expect, it } from 'vitest';
import { elapsedText, errorText, resetText } from './format';

describe('resetText', () => {
  const now = new Date(2026, 9, 2, 10, 0).getTime(); // 로컬 10월 2일 10:00
  it('24시간 안이면 시각', () => {
    expect(resetText(new Date(2026, 9, 2, 18, 5).toISOString(), now)).toBe('18:05 초기화');
  });
  it('그보다 멀면 날짜', () => {
    expect(resetText(new Date(2026, 10, 1, 9, 0).toISOString(), now)).toBe('11월 1일 초기화');
  });
  it('값이 없으면 빈 문자열', () => {
    expect(resetText(undefined, now)).toBe('');
  });
});

describe('errorText', () => {
  it('IPC 오류의 "Error invoking remote method" 접두어를 뺀다', () => {
    const e = new Error("Error invoking remote method 'createTask': Error: git 저장소가 아닙니다");
    expect(errorText(e)).toBe('git 저장소가 아닙니다');
  });
  it('일반 오류는 메시지 그대로', () => {
    expect(errorText(new Error('그냥 오류'))).toBe('그냥 오류');
  });
});

describe('elapsedText', () => {
  const t0 = '2026-10-02T00:00:00.000Z';
  it('1분 미만은 초', () => {
    expect(elapsedText(t0, '2026-10-02T00:00:42.000Z')).toBe('42초');
  });
  it('1시간 미만은 분', () => {
    expect(elapsedText(t0, '2026-10-02T00:12:59.000Z')).toBe('12분');
  });
  it('1시간 이상은 시간과 분', () => {
    expect(elapsedText(t0, '2026-10-02T01:05:00.000Z')).toBe('1시간 5분');
  });
  it('끝나지 않았으면 지금 시각 기준', () => {
    expect(elapsedText(t0, undefined, Date.parse('2026-10-02T00:03:00.000Z'))).toBe('3분');
  });
});
