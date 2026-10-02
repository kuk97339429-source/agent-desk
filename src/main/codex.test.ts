import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexAdapter as a, findCodexExe } from './codex';

describe('codexAdapter args', () => {
  it('runArgs: workspace-write 샌드박스, -C worktree, 지시문 마지막', () => {
    expect(a.runArgs('고쳐줘', 'C:/wt')).toEqual(['exec', '--json', '-s', 'workspace-write', '-C', 'C:/wt', '고쳐줘']);
  });

  it('모델을 고르면 -m, 재개에도 같은 모델', () => {
    expect(a.runArgs('고쳐줘', 'C:/wt', 'gpt-5.5')).toEqual(['exec', '--json', '-m', 'gpt-5.5', '-s', 'workspace-write', '-C', 'C:/wt', '고쳐줘']);
    expect(a.resumeArgs('t-1', 'C:/wt', 'gpt-5.5')).toEqual([
      'exec', 'resume', '--json', '-m', 'gpt-5.5', '-c', 'sandbox_mode="workspace-write"', 't-1', '이어서 진행해줘',
    ]);
  });

  it("'-'로 시작하는 지시문은 앞에 공백", () => {
    expect(a.runArgs('-x', 'C:/wt').at(-1)).toBe(' -x');
  });

  it('resumeArgs: 재개도 workspace-write 샌드박스(resume에는 -s가 없어 -c로)', () => {
    expect(a.resumeArgs('t-1', 'C:/wt')).toEqual([
      'exec', 'resume', '--json', '-c', 'sandbox_mode="workspace-write"', 't-1', '이어서 진행해줘',
    ]);
  });

  it('이어서 지시(설계 18절): 재개 문구 대신 사용자 메시지, -로 시작하면 앞에 공백', () => {
    expect(a.resumeArgs('t-1', 'C:/wt', undefined, '테스트도 추가해줘').at(-1)).toBe('테스트도 추가해줘');
    expect(a.resumeArgs('t-1', 'C:/wt', undefined, '-v 붙여줘').at(-1)).toBe(' -v 붙여줘');
  });

  it('opinionArgs: read-only, -C 원본 저장소', () => {
    expect(a.opinionArgs('누가?', 'C:/repo')).toEqual(['exec', '--json', '-s', 'read-only', '-C', 'C:/repo', '누가?']);
  });
});

describe('codexAdapter.parseLine', () => {
  it('thread.started에서 세션 ID', () => {
    expect(a.parseLine('{"type":"thread.started","thread_id":"t-1"}').sessionId).toBe('t-1');
  });

  it('agent_message는 text 이벤트이자 finalText', () => {
    const p = a.parseLine('{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"완료"}}');
    expect(p.events).toEqual([{ kind: 'text', text: '완료' }]);
    expect(p.finalText).toBe('완료');
  });

  it('명령 실행과 파일 변경은 tool 이벤트', () => {
    expect(a.parseLine('{"type":"item.completed","item":{"type":"command_execution","command":"npm test"}}').events)
      .toEqual([{ kind: 'tool', name: 'shell', detail: 'npm test' }]);
    expect(a.parseLine('{"type":"item.completed","item":{"type":"file_change","changes":[{"path":"a.ts"},{"path":"b.ts"}]}}').events)
      .toEqual([{ kind: 'tool', name: 'edit', detail: 'a.ts, b.ts' }]);
  });

  it('item.type이 error인 항목은 오류 이벤트만 내고 결과는 정하지 않는다', () => {
    const p = a.parseLine('{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Exceeded skills context budget."}}');
    expect(p).toEqual({ events: [{ kind: 'error', message: 'Exceeded skills context budget.' }] });
  });

  it('turn.completed는 done과 토큰 합', () => {
    const p = a.parseLine('{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20}}');
    expect(p.outcome).toEqual({ status: 'done' });
    expect(p.usageDelta).toEqual({ tokens: 120 });
  });

  it('turn.failed 한도 문구는 limited, 그 외는 failed', () => {
    expect(a.parseLine('{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit. Try again in 2 days."}}').outcome?.status)
      .toBe('limited');
    expect(a.parseLine('{"type":"turn.failed","error":{"message":"boom"}}').outcome)
      .toEqual({ status: 'failed', message: 'boom' });
  });

  it('error 이벤트는 오류 이벤트만 내고, 한도일 때만 outcome을 정한다', () => {
    const p = a.parseLine('{"type":"error","message":"Reconnecting... 1/5"}');
    expect(p.events).toEqual([{ kind: 'error', message: 'Reconnecting... 1/5' }]);
    expect(p.outcome).toBeUndefined();
  });

  it('JSON이 아닌 줄은 raw', () => {
    expect(a.parseLine('plain text').events).toEqual([{ kind: 'raw', line: 'plain text' }]);
  });

  it('실제 샘플(fixtures/codex-run.jsonl)에서 세션 ID와 done을 얻는다', () => {
    const f = join(__dirname, '../../fixtures/codex-run.jsonl');
    if (!existsSync(f)) return;
    const parsed = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => a.parseLine(l));
    expect(parsed.some((p) => p.sessionId)).toBe(true);
    expect(parsed.some((p) => p.outcome?.status === 'done')).toBe(true);
  });
});

describe('findCodexExe', () => {
  it('bin/*/codex.exe 중 가장 최근 것을 고른다', () => {
    const base = mkdtempSync(join(tmpdir(), 'codexbin-'));
    for (const [dir, t] of [['old', 1000], ['new', 2000]] as const) {
      mkdirSync(join(base, dir));
      writeFileSync(join(base, dir, 'codex.exe'), '');
      utimesSync(join(base, dir, 'codex.exe'), t, t);
    }
    mkdirSync(join(base, 'empty'));
    expect(findCodexExe(base)).toBe(join(base, 'new', 'codex.exe'));
  });

  it('폴더가 없으면 null', () => {
    expect(findCodexExe(join(tmpdir(), 'no-such-dir-xyz'))).toBeNull();
  });
});
