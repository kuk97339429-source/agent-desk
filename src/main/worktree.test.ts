import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { changes, createWorktree, fileDiff, isDirty, removeWorktree, repoRoot, worktreePath } from './worktree';

let repo: string;

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'agent desk-')); // 공백 포함 경로
  repo = join(base, 'my repo');
  mkdirSync(repo);
  git(repo, 'init');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', '.');
  git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init');
});

describe('worktree', () => {
  it('repoRoot: 하위 폴더에서도 저장소 최상위를, git 아니면 null', async () => {
    mkdirSync(join(repo, 'sub'));
    expect(resolve((await repoRoot(join(repo, 'sub')))!)).toBe(resolve(repo));
    expect(await repoRoot(tmpdir())).toBeNull();
  });

  it('isDirty: 커밋 안 된 변경 감지', async () => {
    expect(await isDirty(repo)).toBe(false);
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    expect(await isDirty(repo)).toBe(true);
  });

  it('create → changes → remove', async () => {
    const wt = await createWorktree(repo, 'abc123');
    expect(wt.path).toBe(worktreePath(repo, 'abc123'));
    expect(wt.path.startsWith(join(repo, ''))).toBe(false); // 원본 폴더 밖
    expect(wt.branch).toBe('tm/abc123');
    expect(existsSync(join(wt.path, 'a.txt'))).toBe(true);

    writeFileSync(join(wt.path, 'a.txt'), 'edited\n');
    writeFileSync(join(wt.path, 'new.txt'), 'new\n');
    const c = await changes(wt.path);
    expect(c.files.sort()).toEqual(['a.txt', 'new.txt']);
    expect(c.stat).toMatch(/1 file changed/);

    await removeWorktree(repo, 'abc123', true); // 고친 파일이 있으므로 버리기를 명시
    expect(existsSync(wt.path)).toBe(false);
    expect(git(repo, 'branch', '--list', 'tm/abc123').trim()).toBe('');
  });

  it('changes: 한글 파일명 그대로, 이름 변경은 새 이름, 새 파일 수는 통계에 함께', async () => {
    const wt = await createWorktree(repo, 'kor1');
    writeFileSync(join(wt.path, '한글.txt'), 'x\n');
    git(wt.path, 'mv', 'a.txt', 'b.txt');
    const c = await changes(wt.path);
    expect(c.files.sort()).toEqual(['b.txt', '한글.txt'].sort());
    expect(c.stat).toContain('새 파일 1개');
  });

  it('작업 브랜치에 합치지 않은 커밋이 있으면 정리를 거부하고 아무것도 지우지 않는다', async () => {
    const wt = await createWorktree(repo, 'keep1');
    writeFileSync(join(wt.path, 'b.txt'), 'b\n');
    git(wt.path, 'add', '.');
    git(wt.path, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'work');
    await expect(removeWorktree(repo, 'keep1')).rejects.toThrow('합치지 않은 커밋 1개');
    expect(existsSync(wt.path)).toBe(true);
    expect(git(repo, 'branch', '--list', 'tm/keep1').trim()).toContain('tm/keep1');
  });

  it('fileDiff(설계 21절): 고친 파일은 git diff, 새 파일은 모든 줄을 +로, 바이너리는 안내만', async () => {
    const wt = await createWorktree(repo, 'diff1');
    writeFileSync(join(wt.path, 'a.txt'), 'edited\n');
    writeFileSync(join(wt.path, '새 파일.txt'), 'one\ntwo\n');
    writeFileSync(join(wt.path, 'bin.dat'), Buffer.from([0, 1, 2, 0]));
    const mod = await fileDiff(wt.path, 'a.txt');
    expect(mod).toContain('-a');
    expect(mod).toContain('+edited');
    expect(await fileDiff(wt.path, '새 파일.txt')).toBe('새 파일\n+one\n+two');
    expect(await fileDiff(wt.path, 'bin.dat')).toContain('바이너리');
  });

  it('커밋하지 않은 변경이 있으면 기본으로 거부하고, discard면 지운다', async () => {
    const wt = await createWorktree(repo, 'dirty1');
    writeFileSync(join(wt.path, 'new.txt'), 'x\n');
    writeFileSync(join(wt.path, 'a.txt'), 'changed\n');
    await expect(removeWorktree(repo, 'dirty1')).rejects.toThrow('커밋하지 않은 변경 2개');
    expect(existsSync(join(wt.path, 'new.txt'))).toBe(true);
    await removeWorktree(repo, 'dirty1', true);
    expect(existsSync(wt.path)).toBe(false);
  });

  it('worktree 폴더를 직접 지웠어도 정리가 끝까지 된다(다시 눌러도 된다)', async () => {
    const wt = await createWorktree(repo, 'gone1');
    rmSync(wt.path, { recursive: true, force: true });
    await removeWorktree(repo, 'gone1');
    expect(git(repo, 'branch', '--list', 'tm/gone1').trim()).toBe('');
    await removeWorktree(repo, 'gone1'); // 두 번째도 오류 없이
  });
});
