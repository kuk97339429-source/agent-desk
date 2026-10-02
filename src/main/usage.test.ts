import { describe, expect, it } from 'vitest';
import { addUsage } from './usage';

describe('addUsage', () => {
  it('비용과 토큰을 각각 누적한다', () => {
    const u = {};
    addUsage(u, { costUsd: 0.1 });
    addUsage(u, { costUsd: 0.25, tokens: 100 });
    addUsage(u, { tokens: 50 });
    expect(u).toEqual({ costUsd: 0.35, tokens: 150 });
  });

  it('undefined 델타는 무시한다', () => {
    const u = { tokens: 5 };
    addUsage(u, undefined);
    expect(u).toEqual({ tokens: 5 });
  });
});
