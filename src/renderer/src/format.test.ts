import { describe, expect, it } from 'vitest';
import type { AgentEvent, Task } from '../../shared/types';
import { agoText, applyDrafts, applyEvents, boardTasks, elapsedText, errorText, diffLines, groupTasks, lastLine, mergeCommands, recentStats, resetText, stepList } from './format';

describe('agoText', () => {
  const now = Date.parse('2026-10-02T10:00:00Z');
  it('10초 미만은 방금, 그다음 초·분', () => {
    expect(agoText('2026-10-02T09:59:55Z', now)).toBe('방금');
    expect(agoText('2026-10-02T09:59:18Z', now)).toBe('42초 전');
    expect(agoText('2026-10-02T09:57:00Z', now)).toBe('3분 전');
    expect(agoText('2026-10-02T05:16:00Z', now)).toBe('4시간 전');
  });
  it('값이 없으면 빈 문자열', () => {
    expect(agoText(undefined, now)).toBe('');
  });
});

describe('resetText', () => {
  const now = new Date(2026, 9, 2, 10, 0).getTime(); // 로컬 10월 2일 10:00
  it('24시간 안이면 시각', () => {
    expect(resetText(new Date(2026, 9, 2, 18, 5).toISOString(), now)).toBe('18:05 초기화');
  });
  it('그보다 멀면 날짜', () => {
    expect(resetText(new Date(2026, 10, 1, 9, 0).toISOString(), now)).toBe('11월 1일 초기화');
  });
  it('값이 없으면 빈 문자열', () => {
    expect(resetText(undefined, now)).toBe('');
  });
});

describe('errorText', () => {
  it('IPC 오류의 "Error invoking remote method" 접두어를 뺀다', () => {
    const e = new Error("Error invoking remote method 'createTask': Error: git 저장소가 아닙니다");
    expect(errorText(e)).toBe('git 저장소가 아닙니다');
  });
  it('일반 오류는 메시지 그대로', () => {
    expect(errorText(new Error('그냥 오류'))).toBe('그냥 오류');
  });
});

describe('elapsedText', () => {
  const t0 = '2026-10-02T00:00:00.000Z';
  it('1분 미만은 초', () => {
    expect(elapsedText(t0, '2026-10-02T00:00:42.000Z')).toBe('42초');
  });
  it('1시간 미만은 분', () => {
    expect(elapsedText(t0, '2026-10-02T00:12:59.000Z')).toBe('12분');
  });
  it('1시간 이상은 시간과 분', () => {
    expect(elapsedText(t0, '2026-10-02T01:05:00.000Z')).toBe('1시간 5분');
  });
  it('끝나지 않았으면 지금 시각 기준', () => {
    expect(elapsedText(t0, undefined, Date.parse('2026-10-02T00:03:00.000Z'))).toBe('3분');
  });
});

describe('boardTasks', () => {
  const now = Date.parse('2026-10-02T10:00:00Z');
  const t = (id: string, status: Task['status'], endedAt?: string): Task => ({
    id, repo: 'r', prompt: id, agent: 'claude', status, usage: {}, createdAt: '2026-10-02T09:00:00Z', endedAt,
  });
  it('실행 중·상의 중을 먼저, 10분 안에 끝난 작업을 뒤에 둔다', () => {
    const tasks = [
      t('recent', 'done', '2026-10-02T09:55:00Z'),
      t('run', 'running'),
      t('old', 'failed', '2026-10-02T09:49:59Z'),
      t('consult', 'consulting'),
      t('limit', 'limited', '2026-10-02T09:59:00Z'),
    ];
    expect(boardTasks(tasks, now).map((x) => x.id)).toEqual(['run', 'consult', 'recent', 'limit']);
  });
});

describe('applyQueued (설계 16절: 들어온 이벤트를 모아 한 번에 반영)', () => {
  const q: [string, AgentEvent][] = [
    ['a', { kind: 'delta', text: '안녕' }],
    ['a', { kind: 'delta', text: '하세요' }],
    ['b', { kind: 'tool', name: 'Read', detail: 'x.ts' }],
    ['a', { kind: 'text', text: '안녕하세요' }],
    ['a', { kind: 'delta', text: '다음' }],
  ];
  it('글 조각은 이어 붙이고 완성된 글이 오면 비운 뒤 다시 모은다', () => {
    expect(applyDrafts({}, q)).toEqual({ a: '다음' });
  });
  it('조각이 아닌 이벤트만 작업별로 순서대로 붙인다', () => {
    expect(applyEvents({}, q, 100)).toEqual({ a: [{ kind: 'text', text: '안녕하세요' }], b: [{ kind: 'tool', name: 'Read', detail: 'x.ts' }] });
  });
  it('작업마다 최근 max개만 남긴다', () => {
    const many: [string, AgentEvent][] = Array.from({ length: 5 }, (_, i) => ['a', { kind: 'text', text: String(i) }]);
    expect(applyEvents({ a: [{ kind: 'text', text: 'old' }] }, many, 3).a.map((e) => (e as { text: string }).text)).toEqual(['2', '3', '4']);
  });
  it('바뀐 것이 없으면 같은 객체를 돌려준다(다시 그리지 않게)', () => {
    const prev = { a: [] };
    expect(applyEvents(prev, [['a', { kind: 'delta', text: 'x' }]], 10)).toBe(prev);
    const d = { a: 'x' };
    expect(applyDrafts(d, [['b', { kind: 'tool', name: 'R', detail: '' }]])).toBe(d);
  });
});

describe('mergeCommands', () => {
  it('작업 폴더에서 커밋한 뒤 원본에서 작업 브랜치를 합치는 세 줄, 메시지의 따옴표·$는 바꾼다', () => {
    const t = { id: 'a1', repo: 'D:/my repo', worktree: 'D:/.tm-worktrees/my repo/a1', branch: 'tm/a1', prompt: '로그인 "버튼" $고치기\n자세한 설명', agent: 'claude', status: 'done', usage: {}, createdAt: '' } as Task;
    expect(mergeCommands(t).split('\n')).toEqual([
      'git -C "D:/.tm-worktrees/my repo/a1" add -A',
      `git -C "D:/.tm-worktrees/my repo/a1" commit -m "agent-desk: 로그인 '버튼' '고치기"`,
      'git -C "D:/my repo" merge tm/a1',
    ]);
  });
});

describe('recentStats (설계 20절, 보내기 전 참고값)', () => {
  const t = (id: string, agent: 'claude' | 'codex', status: Task['status'], min: number, usage: Task['usage']): Task => ({
    id, repo: 'r', prompt: id, agent, status, usage,
    createdAt: '2026-10-02T00:00:00Z', endedAt: new Date(Date.parse('2026-10-02T00:00:00Z') + min * 60000).toISOString(),
  });
  it('끝난 같은 AI 작업 최근 n개의 평균 시간과 사용량', () => {
    const tasks = [
      t('a', 'claude', 'done', 4, { costUsd: 0.2 }),
      t('b', 'claude', 'limited', 10, { costUsd: 0.6 }),
      t('c', 'codex', 'done', 2, { tokens: 5000 }),
      t('d', 'claude', 'running', 0, {}),
      t('e', 'claude', 'done', 1, { costUsd: 0.1 }),
    ];
    expect(recentStats(tasks, 'claude', 2)).toEqual({ count: 2, avgMinutes: 7, avgCostUsd: 0.4, avgTokens: undefined });
    expect(recentStats(tasks, 'codex')).toEqual({ count: 1, avgMinutes: 2, avgCostUsd: undefined, avgTokens: 5000 });
    expect(recentStats([], 'claude')).toBeNull();
  });
});

describe('설계 21절 화면 논리', () => {
  const base = { repo: 'r', prompt: 'p', agent: 'claude' as const, usage: {}, createdAt: '2026-10-03T00:00:00Z' };
  const T = (id: string, extra: Partial<Task>): Task => ({ ...base, id, status: 'done', ...extra });

  it('diffLines: 머리말은 빼고 줄 종류를 나눈다', () => {
    const text = ['diff --git a/a.txt b/a.txt', 'index 1..2 100644', '--- a/a.txt', '+++ b/a.txt', '@@ -1 +1 @@', '-a', '+edited', ' same'].join('\n');
    expect(diffLines(text)).toEqual([
      { kind: 'hunk', text: '@@ -1 +1 @@' },
      { kind: 'del', text: '-a' },
      { kind: 'add', text: '+edited' },
      { kind: 'ctx', text: ' same' },
    ]);
    expect(diffLines('새 파일\n+one')).toEqual([{ kind: 'meta', text: '새 파일' }, { kind: 'add', text: '+one' }]);
    expect(diffLines('\\ No newline at end of file')).toEqual([{ kind: 'meta', text: '(파일 끝에 줄바꿈 없음)' }]);
  });

  it('groupTasks: 확인 필요 → 실행 중 → 검토할 결과 → 끝남, 빈 묶음은 뺀다', () => {
    const tasks = [
      T('run', { status: 'running' }),
      T('ask', { status: 'consulting', agent: null }),
      T('pick', { status: 'consulting', agent: null, consult: { opinions: {}, decision: { assignee: 'claude', reason: '', plan: '' } } }),
      T('lim', { status: 'limited' }),
      T('fail', { status: 'failed' }),
      T('rev', { status: 'done', worktree: 'w', changedFiles: ['a'] }),
      T('clean', { status: 'done' }),
      T('stop', { status: 'cancelled' }),
    ];
    expect(groupTasks(tasks).map((g) => [g.key, g.tasks.map((t) => t.id)])).toEqual([
      ['attention', ['pick', 'lim', 'fail']],
      ['running', ['run', 'ask']],
      ['review', ['rev']],
      ['ended', ['clean', 'stop']],
    ]);
    expect(groupTasks([T('x', { status: 'running' })]).map((g) => g.key)).toEqual(['running']);
  });

  it('lastLine: 상태에 맞는 한 줄', () => {
    expect(lastLine(T('a', { status: 'running', activity: { steps: 3, lastAction: 'Edit a.ts' } }))).toBe('Edit a.ts');
    expect(lastLine(T('b', { status: 'running' }))).toBe('시작하는 중');
    expect(lastLine(T('c', { status: 'failed', error: '로그인이 필요합니다\n자세히' }))).toBe('로그인이 필요합니다');
    expect(lastLine(T('d', { status: 'limited', resetHint: '18:00 이후' }))).toBe('18:00 이후 이어서 하기');
    expect(lastLine(T('e', { status: 'consulting', agent: null, consult: { opinions: {}, decision: { assignee: 'codex', reason: '', plan: '' } } }))).toBe('담당을 골라 주세요');
    expect(lastLine(T('f', { status: 'done', worktree: 'w', changedFiles: ['a', 'b'] }))).toBe('바뀐 파일 2개 검토');
  });

  it('stepList: 나온 [진행 n/N]을 단계 목록으로, 지금 단계 앞은 끝남, 완료면 모두 끝남', () => {
    const ev: AgentEvent[] = [
      { kind: 'text', text: '[진행 1/3] 읽기' },
      { kind: 'tool', name: 'Read', detail: 'a' },
      { kind: 'text', text: '설명\n[진행 2/3] 고치기' },
    ];
    expect(stepList(ev, 'running')).toEqual([
      { n: 1, label: '읽기', state: 'done' },
      { n: 2, label: '고치기', state: 'active' },
      { n: 3, label: undefined, state: 'todo' },
    ]);
    expect(stepList(ev, 'done').every((s) => s.state === 'done')).toBe(true);
    expect(stepList([{ kind: 'text', text: '표시 없음' }], 'running')).toEqual([]);
  });
});
