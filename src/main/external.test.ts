import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readClaudeSessions, readCodexSessions } from './external';

const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

describe('readClaudeSessions', () => {
  function setup() {
    const home = mkdtempSync(join(tmpdir(), 'claudehome-'));
    mkdirSync(join(home, 'sessions'));
    mkdirSync(join(home, 'projects', 'c--Users-User-Capstone'), { recursive: true });
    return home;
  }
  const reg = (pid: number, over: Record<string, unknown> = {}) => ({
    pid,
    sessionId: `s-${pid}`,
    cwd: 'C:\\Users\\User\\Capstone',
    entrypoint: 'claude-desktop',
    name: `세션 ${pid}`,
    status: 'busy',
    updatedAt: 1790943455392,
    ...over,
  });

  it('살아 있는 등록부만, busy는 진행 중, 마지막 assistant 글을 붙인다', () => {
    const home = setup();
    writeFileSync(join(home, 'sessions', '100.json'), JSON.stringify(reg(100)));
    writeFileSync(join(home, 'sessions', '200.json'), JSON.stringify(reg(200, { status: 'idle', entrypoint: 'claude-vscode' })));
    writeFileSync(join(home, 'sessions', '300.json'), JSON.stringify(reg(300))); // 죽은 pid
    writeFileSync(join(home, 'sessions', '100.abc.key'), 'secret'); // 열지 않아야 함
    writeFileSync(
      join(home, 'projects', 'c--Users-User-Capstone', 's-100.jsonl'),
      jsonl([
        { type: 'assistant', message: { content: [{ type: 'text', text: '첫 답' }] } },
        { type: 'user', message: { content: '질문' } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }, { type: 'text', text: '마지막 답' }] } },
        { type: 'last-prompt' },
      ]),
    );
    const list = readClaudeSessions(home, (pid) => pid !== 300)!;
    expect(list.map((s) => s.id).sort()).toEqual(['s-100', 's-200']);
    const s100 = list.find((s) => s.id === 's-100')!;
    expect(s100).toMatchObject({ source: 'claude', name: '세션 100', running: true, where: 'Claude 데스크톱', lastMessage: '마지막 답' });
    expect(list.find((s) => s.id === 's-200')).toMatchObject({ running: false, where: 'VS Code' });
  });

  it('끝부분이 큰 도구 결과로 채워져 있어도 마지막 assistant 글을 찾는다', () => {
    const home = setup();
    writeFileSync(join(home, 'sessions', '100.json'), JSON.stringify(reg(100)));
    const bigToolResult = { type: 'user', message: { content: [{ type: 'tool_result', content: 'x'.repeat(200_000) }] } };
    writeFileSync(
      join(home, 'projects', 'c--Users-User-Capstone', 's-100.jsonl'),
      jsonl([{ type: 'assistant', message: { content: [{ type: 'text', text: '앞선 답' }] } }, bigToolResult]),
    );
    expect(readClaudeSessions(home, () => true)![0].lastMessage).toBe('앞선 답');
  });

  it('agent-desk가 띄운 작업(.tm-worktrees)은 뺀다', () => {
    const home = setup();
    writeFileSync(join(home, 'sessions', '100.json'), JSON.stringify(reg(100, { cwd: 'C:\\x\\.tm-worktrees\\repo\\abc' })));
    expect(readClaudeSessions(home, () => true)).toEqual([]);
  });

  it('깨진 등록부 파일은 건너뛴다', () => {
    const home = setup();
    writeFileSync(join(home, 'sessions', '100.json'), '{broken');
    writeFileSync(join(home, 'sessions', '200.json'), JSON.stringify(reg(200)));
    expect(readClaudeSessions(home, () => true)!.map((s) => s.id)).toEqual(['s-200']);
  });

  it('sessions 폴더가 없으면 null', () => {
    expect(readClaudeSessions(mkdtempSync(join(tmpdir(), 'claudehome-')), () => true)).toBeNull();
  });
});

describe('readCodexSessions', () => {
  const NOW = Date.parse('2026-10-02T10:00:00.000Z');
  function setup() {
    const home = mkdtempSync(join(tmpdir(), 'codexhome-'));
    const day = join(home, 'sessions', '2026', '10', '02');
    mkdirSync(day, { recursive: true });
    return { home, day };
  }
  const meta = (id: string, cwd = 'C:\\Users\\User\\Documents\\Codex') => ({ type: 'session_meta', payload: { id, cwd } });
  const ev = (type: string) => ({ type: 'event_msg', payload: { type } });
  const msg = (text: string) => ({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } });
  function write(dir: string, name: string, lines: unknown[], mtimeMs: number) {
    const f = join(dir, name);
    writeFileSync(f, jsonl(lines));
    utimesSync(f, mtimeMs / 1000, mtimeMs / 1000);
  }

  it('task_started 뒤 task_complete가 없고 최근이면 진행 중, 이름은 session_index에서', () => {
    const { home, day } = setup();
    write(day, 'rollout-a.jsonl', [meta('a'), ev('task_started'), msg('하는 중')], NOW - 60_000);
    write(day, 'rollout-b.jsonl', [meta('b'), ev('task_started'), msg('끝'), ev('task_complete')], NOW - 120_000);
    writeFileSync(
      join(home, 'session_index.jsonl'),
      jsonl([{ id: 'a', thread_name: '옛 이름' }, { id: 'a', thread_name: '수정할 내용 찾기' }]),
    );
    const list = readCodexSessions(home, NOW)!;
    expect(list[0]).toMatchObject({ source: 'codex', id: 'a', name: '수정할 내용 찾기', running: true, lastMessage: '하는 중', where: 'Codex' });
    expect(list[1]).toMatchObject({ id: 'b', running: false, lastMessage: '끝' });
  });

  it('session_meta 첫 줄이 아주 길어도(실제 19KB 이상) id와 cwd를 읽는다', () => {
    const { home, day } = setup();
    const big = { type: 'session_meta', payload: { id: 'big', cwd: 'C:\\Users\\User\\Codex', base_instructions: 'x'.repeat(80_000) } };
    write(day, 'rollout-big.jsonl', [big, ev('task_started')], NOW - 60_000);
    expect(readCodexSessions(home, NOW)).toMatchObject([{ id: 'big', cwd: 'C:\\Users\\User\\Codex', running: true }]);
  });

  it('10분 넘게 기록이 없으면 task_complete가 없어도 대기', () => {
    const { home, day } = setup();
    write(day, 'rollout-c.jsonl', [meta('c'), ev('task_started')], NOW - 11 * 60_000);
    expect(readCodexSessions(home, NOW)![0].running).toBe(false);
  });

  it('24시간 넘은 기록과 .tm-worktrees 작업은 뺀다', () => {
    const { home, day } = setup();
    write(day, 'rollout-old.jsonl', [meta('old')], NOW - 25 * 3_600_000);
    write(day, 'rollout-tm.jsonl', [meta('tm', 'C:\\x\\.tm-worktrees\\repo\\id')], NOW - 60_000);
    expect(readCodexSessions(home, NOW)).toEqual([]);
  });

  it('최대 10개', () => {
    const { home, day } = setup();
    for (let i = 0; i < 12; i++) write(day, `rollout-${i}.jsonl`, [meta(`m${i}`)], NOW - i * 60_000);
    expect(readCodexSessions(home, NOW)).toHaveLength(10);
  });

  it('sessions 폴더가 없으면 null', () => {
    expect(readCodexSessions(mkdtempSync(join(tmpdir(), 'codexhome-')), NOW)).toBeNull();
  });
});
