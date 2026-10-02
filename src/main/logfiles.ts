import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 큰 기록 파일은 끝부분만 읽는다. 잘린 첫 줄은 버린다 */
export function tailLines(file: string, bytes = 64 * 1024): string[] {
  const size = statSync(file).size;
  const start = Math.max(0, size - bytes);
  const buf = Buffer.alloc(size - start);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buf, 0, buf.length, start);
  } finally {
    closeSync(fd);
  }
  const lines = buf.toString('utf8').split('\n');
  if (start > 0) lines.shift();
  return lines.map((l) => l.replace(/\r$/, '')).filter(Boolean);
}

/** 파일 앞부분 첫 줄 */
export function firstLine(file: string, bytes = 16 * 1024): string {
  const buf = Buffer.alloc(Math.min(bytes, statSync(file).size));
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buf, 0, buf.length, 0);
  } finally {
    closeSync(fd);
  }
  return buf.toString('utf8').split('\n')[0].replace(/\r$/, '');
}

export function parseJson(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** dir 아래(최대 depth 단계)에서 이름이 match에 맞는 파일과 수정 시각 */
export function findFiles(dir: string, match: RegExp, depth = 4): { file: string; mtimeMs: number }[] {
  if (!existsSync(dir)) return [];
  const out: { file: string; mtimeMs: number }[] = [];
  const walk = (d: string, left: number) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory() && left > 0) walk(p, left - 1);
      else if (e.isFile() && match.test(e.name)) out.push({ file: p, mtimeMs: statSync(p).mtimeMs });
    }
  };
  walk(dir, depth);
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}
