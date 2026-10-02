import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SetupItem } from '../shared/types';
import { onPath } from './adapter';
import { parseJson } from './logfiles';

/**
 * 첫 실행 점검(설계 20절): git·Claude·Codex 설치와 로그인 여부.
 * 로그인은 ~/.claude.json의 계정 종류와 ~/.codex/auth.json의 "존재"만 본다. 인증 파일 내용은 열지 않는다
 */
export function checkSetup(o: { home: string; pathEnv: string; codexExe: string | null; apiKey: boolean }): SetupItem[] {
  let claudeAcct = false;
  try {
    claudeAcct = !!parseJson(readFileSync(join(o.home, '.claude.json'), 'utf8'))?.oauthAccount;
  } catch {
    // 파일이 없으면 로그인 전
  }
  const codex = o.codexExe !== null || onPath('codex', o.pathEnv);
  return [
    { key: 'git', label: 'Git', ok: onPath('git', o.pathEnv), hint: 'git-scm.com에서 Git을 설치하세요' },
    { key: 'claude', label: 'Claude Code 설치', ok: onPath('claude', o.pathEnv), hint: '터미널에서 npm install -g @anthropic-ai/claude-code' },
    {
      key: 'claude-login',
      label: 'Claude 로그인',
      ok: claudeAcct || o.apiKey,
      hint: claudeAcct ? undefined : o.apiKey ? 'API 키로 실행되어 종량제로 결제됩니다' : '터미널에서 claude를 한 번 실행해 로그인하세요',
    },
    { key: 'codex', label: 'Codex 설치', ok: codex, optional: true, hint: '터미널에서 npm install -g @openai/codex (Codex를 쓸 때만)' },
    {
      key: 'codex-login',
      label: 'Codex 로그인',
      ok: existsSync(join(o.home, '.codex', 'auth.json')),
      optional: true,
      hint: '터미널에서 codex login (Codex를 쓸 때만)',
    },
  ];
}
