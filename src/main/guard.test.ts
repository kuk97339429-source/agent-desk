import { describe, expect, it } from 'vitest';
import { consultBlocked, sessionCommand, usageGuard } from './guard';

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
});

describe('consultBlocked', () => {
  it('막힌 AI 목록', () => {
    expect(consultBlocked({ claude: usage(95), codex: usage(10) })).toEqual(['claude']);
    expect(consultBlocked({ claude: usage(95), codex: { ...usage(92), agent: 'codex' } })).toEqual(['claude', 'codex']);
    expect(consultBlocked({})).toEqual([]);
  });
});

describe('sessionCommand', () => {
  it('세션이 있으면 그 폴더에서 이어서, 인자 배열로', () => {
    expect(sessionCommand('claude', 'C:\\wt dir', 'abc-123', 'claude')).toEqual({
      cmd: 'cmd',
      // start의 첫 인자는 따옴표로 감싸져야 창 제목으로 인식된다. Node는 공백이 있는 인자만 따옴표로 감싼다
      args: ['/c', 'start', 'agent-desk 세션', '/D', 'C:\\wt dir', 'cmd', '/k', 'claude', '--resume', 'abc-123'],
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
