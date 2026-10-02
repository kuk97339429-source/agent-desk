import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { onPath } from './adapter';

describe('onPath', () => {
  it('PATH의 폴더 중 하나에 실행 파일이 있으면 true', () => {
    const a = mkdtempSync(join(tmpdir(), 'path-a-'));
    const b = mkdtempSync(join(tmpdir(), 'path-b-'));
    const file = process.platform === 'win32' ? 'mycli.exe' : 'mycli';
    writeFileSync(join(b, file), '');
    expect(onPath('mycli', [a, b].join(delimiter))).toBe(true);
  });

  it('없으면 false', () => {
    const a = mkdtempSync(join(tmpdir(), 'path-a-'));
    expect(onPath('mycli', a)).toBe(false);
  });

  it('Windows에서 .cmd만 있으면 false(shell 없이 실행할 수 없음)', () => {
    if (process.platform !== 'win32') return;
    const a = mkdtempSync(join(tmpdir(), 'path-a-'));
    writeFileSync(join(a, 'mycli.cmd'), '');
    expect(onPath('mycli', a)).toBe(false);
  });
});
