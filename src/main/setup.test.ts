import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSetup } from './setup';

function env(files: Record<string, string>) {
  const home = mkdtempSync(join(tmpdir(), 'setup-'));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(home, rel, '..'), { recursive: true });
    writeFileSync(join(home, rel), body);
  }
  return { home, bin };
}
const exe = (n: string) => (process.platform === 'win32' ? `bin/${n}.exe` : `bin/${n}`);

describe('checkSetup (설계 20절, 첫 실행 점검)', () => {
  it('모두 갖췄으면 전부 ok, 로그인은 파일 존재와 계정 종류로만 판단', () => {
    const { home, bin } = env({
      [exe('git')]: '',
      [exe('claude')]: '',
      [exe('codex')]: '',
      '.claude.json': JSON.stringify({ oauthAccount: { organizationType: 'claude_pro' } }),
      '.codex/auth.json': '{}',
    });
    const items = checkSetup({ home, pathEnv: bin, codexExe: null, apiKey: false });
    expect(items.map((i) => [i.key, i.ok])).toEqual([
      ['git', true],
      ['claude', true],
      ['claude-login', true],
      ['codex', true],
      ['codex-login', true],
    ]);
  });

  it('없는 것은 ok=false와 안내, Codex는 선택 항목', () => {
    const { home, bin } = env({ [exe('git')]: '', [exe('claude')]: '' });
    const items = checkSetup({ home, pathEnv: bin, codexExe: null, apiKey: false });
    const by = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(by['claude-login']).toMatchObject({ ok: false, hint: expect.stringContaining('로그인') });
    expect(by.codex).toMatchObject({ ok: false, optional: true, hint: expect.stringContaining('@openai/codex') });
    expect(by['codex-login'].optional).toBe(true);
    expect(by.git.optional).toBeFalsy();
  });

  it('Claude 로그인 정보가 없어도 API 키가 있으면 사용 가능(종량제 안내)', () => {
    const { home, bin } = env({ [exe('claude')]: '' });
    const login = checkSetup({ home, pathEnv: bin, codexExe: null, apiKey: true }).find((i) => i.key === 'claude-login')!;
    expect(login).toMatchObject({ ok: true, hint: expect.stringContaining('종량제') });
  });

  it('Codex 앱이 설치한 실행 파일이 있으면 PATH에 없어도 설치된 것으로 본다', () => {
    const { home, bin } = env({});
    expect(checkSetup({ home, pathEnv: bin, codexExe: 'C:/codex.exe', apiKey: false }).find((i) => i.key === 'codex')!.ok).toBe(true);
  });
});
