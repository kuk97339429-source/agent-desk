import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Task } from '../shared/types';
import type { Adapter } from './adapter';
import { Consultant, type RunOnce, decideByRule, parseDecision, parseOpinion } from './consultant';
import { TaskStore } from './taskStore';

const op = (fit: string, approach = 'a') => JSON.stringify({ approach, difficulty: 2, fit, reason: 'r' });

describe('parseOpinion', () => {
  it('순수 JSON', () => {
    expect(parseOpinion(op('me'))).toEqual({ approach: 'a', difficulty: 2, fit: 'me', reason: 'r' });
  });
  it('코드펜스와 설명 문장이 섞여도 읽는다', () => {
    expect(parseOpinion(`판단 결과입니다.\n\`\`\`json\n${op('other')}\n\`\`\`\n참고하세요.`)?.fit).toBe('other');
  });
  it('앞뒤 문장에 {…}가 섞여도 의견 JSON을 찾는다', () => {
    expect(parseOpinion(`fit 기준은 {me}입니다.\n${op('other')}\n참고 {x}`)?.fit).toBe('other');
  });
  it('JSON이 아닌 코드펜스가 앞에 있어도 뒤의 JSON 펜스를 읽는다', () => {
    expect(parseOpinion(`\`\`\`bash\nls\n\`\`\`\n\`\`\`json\n${op('me')}\n\`\`\``)?.fit).toBe('me');
  });
  it('난이도는 1~5로 자르고, 숫자가 아니면 3', () => {
    expect(parseOpinion(JSON.stringify({ approach: 'a', difficulty: 9, fit: 'me', reason: 'r' }))?.difficulty).toBe(5);
    expect(parseOpinion(JSON.stringify({ approach: 'a', difficulty: 'hard', fit: 'me', reason: 'r' }))?.difficulty).toBe(3);
  });
  it('필드가 틀리면 null', () => {
    expect(parseOpinion('{"approach":"a","fit":"maybe","reason":"r"}')).toBeNull();
    expect(parseOpinion('그냥 문장')).toBeNull();
  });
});

describe('parseDecision', () => {
  it('assignee는 claude/codex만', () => {
    expect(parseDecision('{"assignee":"codex","reason":"r","plan":"p"}')).toEqual({ assignee: 'codex', reason: 'r', plan: 'p' });
    expect(parseDecision('{"assignee":"gemini","reason":"r","plan":"p"}')).toBeNull();
  });
});

describe('decideByRule', () => {
  const o = (fit: 'me' | 'other' | 'either') => ({ approach: `by-${fit}`, difficulty: 2, fit, reason: 'r' });
  it('둘이 같은 AI를 가리키면 결정', () => {
    expect(decideByRule({ claude: o('other'), codex: o('me') })).toMatchObject({ assignee: 'codex', plan: 'by-me' });
  });
  it('갈리면 need-decider', () => {
    expect(decideByRule({ claude: o('me'), codex: o('me') })).toBe('need-decider');
    expect(decideByRule({ claude: o('either'), codex: o('either') })).toBe('need-decider');
  });
  it('한쪽만 있으면 그 의견대로, either면 그 AI 자신', () => {
    expect(decideByRule({ claude: o('other'), codex: { error: 'x' } })).toMatchObject({ assignee: 'codex' });
    expect(decideByRule({ codex: o('either') })).toMatchObject({ assignee: 'codex' });
  });
  it('둘 다 실패면 manual', () => {
    expect(decideByRule({ claude: { error: 'x' }, codex: { error: 'y' } })).toBe('manual');
  });
});

describe('Consultant.consult', () => {
  const dummy = (id: 'claude' | 'codex'): Adapter => ({
    id,
    isAvailable: () => true,
    command: () => id,
    runArgs: () => [],
    resumeArgs: () => [],
    opinionArgs: (p) => [id, p],
    parseLine: () => ({ events: [] }),
  });

  function setup(run: RunOnce) {
    const store = new TaskStore(join(mkdtempSync(join(tmpdir(), 'cons-')), 'tasks.json'));
    const t: Task = { id: 'q', repo: 'C:/r', prompt: '번역해줘', agent: null, status: 'consulting', usage: {}, createdAt: '2026-10-02T00:00:00Z' };
    store.save(t);
    const c = new Consultant(store, { claude: dummy('claude'), codex: dummy('codex') }, { update: () => {}, event: () => {} }, run);
    return { store, c };
  }

  it('의견이 일치하면 결정자 호출 없이 결정, 사용량 합산', async () => {
    const run = vi.fn<RunOnce>(async (a) => ({
      finalText: a.id === 'claude' ? op('other', 'claude-plan') : op('me', 'codex-plan'),
      usage: a.id === 'claude' ? { costUsd: 0.05 } : { tokens: 300 },
    }));
    const { store, c } = setup(run);
    await c.consult('q');
    expect(run).toHaveBeenCalledTimes(2);
    expect(store.get('q')!.consult!.decision).toMatchObject({ assignee: 'codex', plan: 'codex-plan' });
    expect(store.get('q')!.usage).toEqual({ costUsd: 0.05, tokens: 300 });
    expect(store.get('q')!.status).toBe('consulting');
  });

  it('갈리면 Claude 결정자를 한 번 더 부른다', async () => {
    const run = vi.fn<RunOnce>(async (_a, args) => ({
      finalText: String(args[1]).includes('최종') ? '{"assignee":"claude","reason":"r","plan":"p"}' : op('me'),
      usage: {},
    }));
    const { store, c } = setup(run);
    await c.consult('q');
    expect(run).toHaveBeenCalledTimes(3);
    expect(store.get('q')!.consult!.decision).toEqual({ assignee: 'claude', reason: 'r', plan: 'p' });
  });

  it('한쪽이 최근 한도면 상의 없이 다른 쪽', async () => {
    const run = vi.fn<RunOnce>();
    const { store, c } = setup(run);
    store.save({ id: 'old', repo: 'C:/r', prompt: 'x', agent: 'codex', status: 'limited', resetHint: '18:00 이후', usage: {}, createdAt: '2026-10-01T00:00:00Z', endedAt: new Date().toISOString() });
    await c.consult('q');
    expect(run).not.toHaveBeenCalled();
    expect(store.get('q')!.consult!.decision!.assignee).toBe('claude');
  });

  it('사용률 90% 이상으로 막힌 AI가 있으면 상의 없이 다른 쪽에 배정', async () => {
    const run = vi.fn<RunOnce>();
    const { store, c } = setup(run);
    await c.consult('q', ['codex']);
    expect(run).not.toHaveBeenCalled();
    expect(store.get('q')!.consult!.decision).toMatchObject({ assignee: 'claude' });
    expect(store.get('q')!.consult!.decision!.reason).toContain('사용률');
  });

  it('둘 다 실패하면 결정 없이 의견 오류만 남긴다', async () => {
    const { store, c } = setup(async () => ({ finalText: '', usage: {}, error: 'limit' }));
    await c.consult('q');
    expect(store.get('q')!.consult!.decision).toBeUndefined();
    expect(store.get('q')!.consult!.opinions.codex).toEqual({ error: 'limit' });
  });

  it('결정자를 부르기 전에 두 의견을 먼저 화면에 보낸다', async () => {
    const store = new TaskStore(join(mkdtempSync(join(tmpdir(), 'cons-')), 'tasks.json'));
    store.save({ id: 'q', repo: 'C:/r', prompt: '번역해줘', agent: null, status: 'consulting', usage: {}, createdAt: '2026-10-02T00:00:00Z' });
    let publishedOpinions = 0;
    let seenBeforeDecider = -1;
    const run: RunOnce = async (_a, args) => {
      if (String(args[1]).includes('최종')) {
        seenBeforeDecider = publishedOpinions;
        return { finalText: '{"assignee":"claude","reason":"r","plan":"p"}', usage: {} };
      }
      return { finalText: op('me'), usage: {} };
    };
    const emit = {
      update: (t: Task) => { publishedOpinions = Math.max(publishedOpinions, Object.keys(t.consult?.opinions ?? {}).length); },
      event: () => {},
    };
    await new Consultant(store, { claude: dummy('claude'), codex: dummy('codex') }, emit, run).consult('q');
    expect(seenBeforeDecider).toBe(2);
  });

  it('결정자가 실패하면 그 오류를 남긴다', async () => {
    const { store, c } = setup(async (_a, args) =>
      String(args[1]).includes('최종') ? { finalText: '', usage: {}, error: '시간 초과' } : { finalText: op('me'), usage: {} },
    );
    await c.consult('q');
    expect(store.get('q')!.consult!.decision).toBeUndefined();
    expect(store.get('q')!.consult!.error).toContain('시간 초과');
  });

  it('상의 단계 출력도 작업 로그에 남긴다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cons-log-'));
    const store = new TaskStore(join(dir, 'tasks.json'));
    store.save({ id: 'q', repo: 'C:/r', prompt: 'p', agent: null, status: 'consulting', usage: {}, createdAt: '2026-10-02T00:00:00Z' });
    const run: RunOnce = async (a, _args, _cwd, onLine) => {
      onLine?.(`line-from-${a.id}`);
      return { finalText: op('either'), usage: {} };
    };
    await new Consultant(store, { claude: dummy('claude'), codex: dummy('codex') }, { update: () => {}, event: () => {} }, run, join(dir, 'logs')).consult('q');
    const log = readFileSync(join(dir, 'logs', 'q.jsonl'), 'utf8');
    expect(log).toContain('line-from-claude');
    expect(log).toContain('line-from-codex');
  });

  it('상의 중 취소되면 결과를 덮어쓰지 않는다', async () => {
    const { store, c } = setup(async () => {
      store.get('q')!.status = 'cancelled';
      return { finalText: op('me'), usage: {} };
    });
    await c.consult('q');
    expect(store.get('q')!.status).toBe('cancelled');
    expect(store.get('q')!.consult!.decision).toBeUndefined();
  });
});
