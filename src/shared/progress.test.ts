import { describe, expect, it } from 'vitest';
import { PROGRESS_HINT, parseProgress, progressPercent } from './progress';

describe('parseProgress', () => {
  it('[진행 n/N] 단계 이름을 읽는다', () => {
    expect(parseProgress('[진행 2/5] 테스트 작성')).toEqual({ step: 2, total: 5, label: '테스트 작성' });
  });
  it('글 안에 여러 개면 마지막 것, 공백 변형도 허용', () => {
    expect(parseProgress('앞부분\n[진행 1 / 3] 읽기\n중간\n[진행3/3]  마무리\n끝')).toEqual({ step: 3, total: 3, label: '마무리' });
  });
  it('말이 안 되는 값과 표시 없음은 null', () => {
    expect(parseProgress('[진행 0/3] x')).toBeNull();
    expect(parseProgress('[진행 4/3] x')).toBeNull();
    expect(parseProgress('그냥 글')).toBeNull();
  });
});

describe('progressPercent', () => {
  it('시작한 단계는 아직 끝나지 않은 것으로 본다, 완료면 100', () => {
    expect(progressPercent({ step: 1, total: 4 }, 'running')).toBe(0);
    expect(progressPercent({ step: 3, total: 4 }, 'running')).toBe(50);
    expect(progressPercent({ step: 3, total: 4 }, 'done')).toBe(100);
  });
});

describe('PROGRESS_HINT', () => {
  it('형식 예시가 파서와 맞는다', () => {
    expect(PROGRESS_HINT).toContain('[진행 n/N]');
  });
});
