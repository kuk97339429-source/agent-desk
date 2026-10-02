import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { codexModelOfSession } from './account';
import { type Adapter, type ParsedLine, RESUME_PROMPT, onPath, safePrompt, tryJson } from './adapter';
import { detectLimit } from './limit';

export function findCodexExe(
  base = join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin'),
): string | null {
  if (!existsSync(base)) return null;
  const candidates = readdirSync(base)
    .map((d) => join(base, d, 'codex.exe'))
    .filter((p) => existsSync(p));
  if (candidates.length === 0) return null;
  return candidates.sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs)[0];
}

const modelArgs = (model?: string) => (model ? ['-m', model] : []);

function failure(message: string): ParsedLine {
  const lim = detectLimit(message);
  return {
    events: [{ kind: 'error', message }],
    outcome: lim.limited ? { status: 'limited', message, resetHint: lim.resetHint } : { status: 'failed', message },
  };
}

function itemCompleted(it: Record<string, unknown>): ParsedLine {
  if (it.type === 'agent_message' && typeof it.text === 'string') {
    return { events: [{ kind: 'text', text: it.text }], finalText: it.text };
  }
  if (it.type === 'command_execution') {
    return { events: [{ kind: 'tool', name: 'shell', detail: String(it.command ?? '') }] };
  }
  if (it.type === 'file_change') {
    const paths = ((it.changes as { path?: string }[] | undefined) ?? []).map((c) => c.path).join(', ');
    return { events: [{ kind: 'tool', name: 'edit', detail: paths }] };
  }
  if (it.type === 'error') {
    // 경고성 항목(예: 스킬 목록 예산 초과)이라 작업 결과는 정하지 않는다
    return { events: [{ kind: 'error', message: String(it.message ?? '') }] };
  }
  return { events: [] };
}

export function parseCodexLine(line: string): ParsedLine {
  const obj = tryJson(line);
  if (!obj) return { events: [{ kind: 'raw', line }] };

  switch (obj.type) {
    case 'thread.started':
      return { events: [], sessionId: typeof obj.thread_id === 'string' ? obj.thread_id : undefined };
    case 'item.completed':
      return itemCompleted((obj.item ?? {}) as Record<string, unknown>);
    case 'turn.completed': {
      const u = (obj.usage ?? {}) as Record<string, number>;
      return {
        events: [],
        outcome: { status: 'done' },
        usageDelta: { tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) },
      };
    }
    case 'turn.failed':
      return failure(String((obj.error as { message?: string } | undefined)?.message ?? 'turn failed'));
    case 'error': {
      // 재연결 같은 일시 오류도 이 타입으로 오므로 한도일 때만 결과를 정한다
      const message = String(obj.message ?? 'error');
      return detectLimit(message).limited ? failure(message) : { events: [{ kind: 'error', message }] };
    }
    default:
      return { events: [] };
  }
}

export const codexAdapter: Adapter = {
  id: 'codex',
  isAvailable: () => findCodexExe() !== null || onPath('codex'),
  command: () => findCodexExe() ?? 'codex',
  runArgs: (prompt, cwd, model) => ['exec', '--json', ...modelArgs(model), '-s', 'workspace-write', '-C', cwd, safePrompt(prompt)],
  // `exec resume`에는 -s 옵션이 없어 설정 값으로 샌드박스를 넘긴다(codex exec resume --help 확인)
  resumeArgs: (sessionId, _cwd, model, message) => [
    'exec', 'resume', '--json', ...modelArgs(model), '-c', 'sandbox_mode="workspace-write"', sessionId, safePrompt(message ?? RESUME_PROMPT),
  ],
  opinionArgs: (prompt, repo) => ['exec', '--json', '-s', 'read-only', '-C', repo, safePrompt(prompt)],
  parseLine: parseCodexLine,
  // codex exec --json 출력에는 모델이 없어 세션 기록(rollout)에서 찾는다
  modelOfSession: (sessionId) => codexModelOfSession(join(homedir(), '.codex'), sessionId),
};
