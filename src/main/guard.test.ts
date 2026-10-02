import { describe, expect, it } from 'vitest';
import { checkTaskInput, consultBlocked, sessionCommand, usageGuard } from './guard';

const usage = (...pcts: number[]) => ({ agent: 'claude' as const, checkedAt: 'x', windows: pcts.map((p, i) => ({ label: `w${i}`, percent: p })) });

describe('usageGuard', () => {
  it('가장 높은 창 기준: 80% 미만 ok, 80% 이상 warn, 90% 이상 block', () => {
    expect(usageGuard(usage(22, 64)).level).toBe('ok');
    expect(usageGuard(usage(22, 85)).level).toBe('warn');
    expect(usageGuard(usage(91, 10))).toMatchObject({ level: 'block', percent: 91 });
  });
  it('사용률을 모르면 검사하지 않는다', () => {
    expect(usageGuard(undefined).level).toBe('ok');
    expect(usageGuard(usage()).level).toBe('ok');
  });
  const now = Date.parse('2026-10-02T17:00:00Z');
  it('초기화 시각이 지난 창은 옛 값이라 판단에서 뺀다', () => {
    const u = {
      agent: 'claude' as const,
      checkedAt: '2026-10-02T16:50:00Z',
      windows: [
        { label: '5시간', percent: 92, resetsAt: '2026-10-02T16:40:00Z' },
        { label: '7일', percent: 72, resetsAt: '2026-10-03T13:00:00Z' },
      ],
    };
    expect(usageGuard(u, now)).toMatchObject({ level: 'ok', percent: 72, window: '7일' });
  });
  it('30분 넘게 지난 값이면 stale', () => {
    expect(usageGuard({ ...usage(50), checkedAt: '2026-10-02T16:29:00Z' }, now).stale).toBe(true);
    expect(usageGuard({ ...usage(50), checkedAt: '2026-10-02T16:31:00Z' }, now).stale).toBe(false);
  });
});

describe('consultBlocked', () => {
  it('막힌 AI 목록', () => {
    expect(consultBlocked({ claude: usage(95), codex: usage(10) })).toEqual(['claude']);
    expect(consultBlocked({ claude: usage(95), codex: { ...usage(92), agent: 'codex' } })).toEqual(['claude', 'codex']);
    expect(consultBlocked({})).toEqual([]);
  });
});

describe('sessionCommand', () => {
  it('세션이 있으면 이어서, 인자 배열로. 폴더는 명령줄이 아니라 cwd로 넘긴다(& 같은 문자가 든 폴더 이름 대비)', () => {
    expect(sessionCommand('claude', 'C:\\R&D dir', 'abc-123', 'claude')).toEqual({
      cmd: 'cmd',
      cwd: 'C:\\R&D dir',
      // start의 첫 인자는 따옴표로 감싸져야 창 제목으로 인식된다. Node는 공백이 있는 인자만 따옴표로 감싼다
      args: ['/c', 'start', 'agent-desk 세션', 'cmd', '/k', 'claude', '--resume', 'abc-123'],
    });
    expect(sessionCommand('codex', 'C:\\wt', 'x1', 'C:\\codex.exe').args.slice(-3)).toEqual(['C:\\codex.exe', 'resume', 'x1']);
  });
  it('세션이 없으면 새로 연다', () => {
    expect(sessionCommand('claude', 'C:\\repo', undefined, 'claude').args.slice(-1)).toEqual(['claude']);
  });
  it('세션 ID에 영문·숫자·- 외의 문자가 있으면 거부(명령 주입 방지)', () => {
    expect(() => sessionCommand('claude', 'C:\\wt', 'a & del *', 'claude')).toThrow('세션 ID');
  });
});

describe('checkTaskInput (화면에서 온 값 검증)', () => {
  const ok = { repo: 'C:/repo', prompt: '고쳐줘', agent: 'claude' };
  it('정상 값은 통과', () => {
    expect(() => checkTaskInput(ok)).not.toThrow();
    expect(() => checkTaskInput({ ...ok, agent: 'consult', models: { claude: 'opus', codex: 'gpt-5.5' } })).not.toThrow();
  });
  it('알 수 없는 AI, 빈 지시문, 너무 긴 지시문, 이상한 모델 이름은 거부', () => {
    expect(() => checkTaskInput({ ...ok, agent: 'x' })).toThrow('알 수 없는 AI');
    expect(() => checkTaskInput({ ...ok, prompt: '  ' })).toThrow('지시문');
    expect(() => checkTaskInput({ ...ok, prompt: 'a'.repeat(20_001) })).toThrow('너무 깁니다');
    expect(() => checkTaskInput({ ...ok, models: { claude: '--dangerously-skip-permissions' } })).toThrow('모델');
    expect(() => checkTaskInput({ ...ok, models: { gemini: 'x' } })).toThrow('모델');
  });
});
