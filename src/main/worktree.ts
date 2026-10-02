import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  // 바뀐 파일이 많으면 status 출력이 기본 한도(1MB)를 넘어 변경 목록이 통째로 빠진다
  const { stdout } = await exec('git', ['-C', cwd, ...args], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

export async function repoRoot(dir: string): Promise<string | null> {
  try {
    return resolve((await git(dir, ['rev-parse', '--show-toplevel'])).trim());
  } catch {
    return null;
  }
}

export async function isDirty(repo: string): Promise<boolean> {
  return (await git(repo, ['status', '--porcelain'])).trim().length > 0;
}

export function worktreePath(repo: string, id: string): string {
  return join(dirname(repo), '.tm-worktrees', basename(repo), id);
}

export async function createWorktree(repo: string, id: string): Promise<{ path: string; branch: string }> {
  const path = worktreePath(repo, id);
  const branch = `tm/${id}`;
  await git(repo, ['worktree', 'add', '-b', branch, path, 'HEAD']);
  return { path, branch };
}

export async function changes(worktree: string): Promise<{ files: string[]; stat: string }> {
  // -z와 quotePath=false: 한글 파일명을 8진수로 바꾸지 않고, 이름 변경은 "새 이름\0옛 이름"으로 받는다
  const entries = (await git(worktree, ['-c', 'core.quotePath=false', 'status', '--porcelain', '-z', '--untracked-files=all']))
    .split('\0')
    .filter(Boolean);
  const files: string[] = [];
  let untracked = 0;
  for (let i = 0; i < entries.length; i++) {
    const code = entries[i].slice(0, 2);
    files.push(entries[i].slice(3));
    if (code === '??') untracked++;
    if (code[0] === 'R' || code[0] === 'C') i++; // 다음 항목은 옛 이름
  }
  const tracked = (await git(worktree, ['diff', '--stat', 'HEAD'])).trim().split('\n').pop() ?? '';
  const stat = [tracked, untracked > 0 ? `새 파일 ${untracked}개` : ''].filter(Boolean).join(' · ');
  return { files, stat };
}

const MAX_DIFF = 200_000; // 화면으로 보내는 diff 상한(자)

/** 작업 폴더에서 파일 하나가 바뀐 내용(설계 21절). 새 파일은 모든 줄을 +로, 바이너리는 안내만 */
export async function fileDiff(worktree: string, file: string): Promise<string> {
  const status = await git(worktree, ['-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all', '--', file]);
  let out: string;
  if (status.startsWith('??')) {
    const body = readFileSync(join(worktree, file));
    out = body.includes(0)
      ? '바이너리 파일이라 내용을 보여 주지 않습니다'
      : `새 파일\n${body.toString('utf8').replace(/\r?\n$/, '').split(/\r?\n/).map((l) => `+${l}`).join('\n')}`;
  } else {
    out = await git(worktree, ['-c', 'core.quotePath=false', 'diff', 'HEAD', '--', file]);
    if (/^Binary files /m.test(out)) out = '바이너리 파일이라 내용을 보여 주지 않습니다';
  }
  return out.length > MAX_DIFF ? `${out.slice(0, MAX_DIFF)}\n… (너무 길어 여기까지만 보여 줍니다)` : out;
}

async function branchExists(repo: string, branch: string): Promise<boolean> {
  try {
    await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

// 정리는 여러 번 눌러도 되게 하고, 사용자가 작업 브랜치에 커밋해 둔 것은 절대 지우지 않는다
// AI는 파일만 고치고 커밋하지 않으므로, 작업 결과는 대개 커밋되지 않은 변경으로 남아 있다.
// discard를 명시하지 않으면 그 변경을 지우지 않는다
export async function removeWorktree(repo: string, id: string, discard = false): Promise<void> {
  const path = worktreePath(repo, id);
  const branch = `tm/${id}`;
  if (!discard && existsSync(path)) {
    const n = (await git(path, ['status', '--porcelain'])).split('\n').filter(Boolean).length;
    if (n > 0) throw new Error(`작업 폴더에 커밋하지 않은 변경 ${n}개가 있습니다. 지우면 되돌릴 수 없습니다.`);
  }
  if (await branchExists(repo, branch)) {
    const ahead = Number((await git(repo, ['rev-list', '--count', `HEAD..${branch}`])).trim());
    if (ahead > 0) {
      throw new Error(
        `${branch} 브랜치에 아직 합치지 않은 커밋 ${ahead}개가 있어 정리하지 않았습니다. merge하거나 브랜치를 직접 지운 뒤 다시 정리하세요.`,
      );
    }
  }
  if (existsSync(path)) await git(repo, ['worktree', 'remove', '--force', path]);
  else await git(repo, ['worktree', 'prune']);
  if (await branchExists(repo, branch)) await git(repo, ['branch', '-D', branch]);
}
