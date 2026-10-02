import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, Task } from '../shared/types';
import type { Adapter, ParsedLine } from './adapter';
import { PROGRESS_HINT } from '../shared/progress';
import { TaskRunner, promptFor, resolveOutcome } from './runner';
import { TaskStore } from './taskStore';

function fakeAdapter(script: string): Adapter {
  const parse = (line: string): ParsedLine => {
    const o = JSON.parse(line);
    if (o.t === 'delta') return { events: [{ kind: 'delta', text: o.v }] };
    if (o.t === 'text') return { events: [{ kind: 'text', text: o.v }] };
    if (o.t === 'tool') return { events: [{ kind: 'tool', name: 'Write', detail: o.v }] };
    if (o.t === 'sid') return { events: [], sessionId: o.v, usageDelta: { tokens: 10 } };
    if (o.t === 'done') return { events: [], outcome: { status: 'done' } };
    if (o.t === 'limit') return { events: [], outcome: { status: 'limited', message: '한도', resetHint: '18:00 이후' } };
    if (o.t === 'fail') return { events: [], outcome: { status: 'failed', message: 'later failure' } };
    return { events: [] };
  };
  return {
    id: 'claude',
    isAvailable: () => true,
    command: () => process.execPath,
    runArgs: () => ['-e', script],
    resumeArgs: () => ['-e', script],
    opinionArgs: () => [],
    parseLine: parse,
  };
}

let repo: string;
let store: TaskStore;
let events: AgentEvent[];
let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'runner-'));
  repo = join(base, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['-C', repo, 'init']);
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init']);
  store = new TaskStore(join(base, 'data', 'tasks.json'));
  events = [];
});

function newTask(id: string): Task {
  const t: Task = { id, repo, prompt: 'p', agent: 'claude', status: 'running', usage: {}, createdAt: new Date().toISOString() };
  store.save(t);
  return t;
}

function runner(script: string) {
  return new TaskRunner(
    store,
    { claude: fakeAdapter(script), codex: fakeAdapter(script) },
    { update: () => {}, event: (_id, e) => events.push(e) },
    join(base, 'data', 'logs'),
  );
}

const OK_SCRIPT = `
const fs = require('fs');
console.log(JSON.stringify({t:'sid', v:'s-1'}));
console.log(JSON.stringify({t:'delta', v:'hel'}));
console.log(JSON.stringify({t:'text', v:'hello'}));
fs.writeFileSync('made.txt', 'x');
console.log(JSON.stringify({t:'done'}));`;

describe('TaskRunner', () => {
  it('start: worktree에서 실행하고 이벤트·세션·사용량·변경 파일·done을 기록', async () => {
    newTask('ok1');
    const r = runner(OK_SCRIPT);
    await r.start('ok1');
    const t = store.get('ok1')!;
    expect(t.status).toBe('done');
    expect(t.sessionId).toBe('s-1');
    expect(t.usage.tokens).toBe(10);
    expect(t.changedFiles).toEqual(['made.txt']);
    expect(existsSync(join(t.worktree!, 'made.txt'))).toBe(true);
    expect(existsSync(join(repo, 'made.txt'))).toBe(false); // 원본은 그대로
    expect(events).toContainEqual({ kind: 'text', text: 'hello' });
    expect(r.readEvents('ok1')).toContainEqual({ kind: 'text', text: 'hello' });
    // 쓰는 중인 글 조각은 실시간으로만 보내고, 지난 기록에는 완성된 글만 남긴다(설계 16절)
    expect(events).toContainEqual({ kind: 'delta', text: 'hel' });
    expect(r.readEvents('ok1')).not.toContainEqual({ kind: 'delta', text: 'hel' });
    expect(t.activity?.steps).toBe(1);
  });

  it('cancel: cancelled로 끝난다', async () => {
    newTask('c1');
    const r = runner('setTimeout(() => {}, 60000)');
    const p = r.start('c1');
    await new Promise((res) => setTimeout(res, 1500));
    r.cancel('c1');
    await p;
    expect(store.get('c1')!.status).toBe('cancelled');
  }, 15000);

  it('stderr의 한도 문구 + 비정상 종료는 limited', async () => {
    newTask('l1');
    await runner("console.error('usage limit reached'); process.exit(1)").start('l1');
    expect(store.get('l1')!.status).toBe('limited');
  });

  it('한 번 limited가 된 결과는 뒤 줄의 failed가 덮어쓰지 않는다', async () => {
    newTask('l2');
    await runner("console.log(JSON.stringify({t:'limit'})); console.log(JSON.stringify({t:'fail'})); process.exit(1)").start('l2');
    expect(store.get('l2')).toMatchObject({ status: 'limited', resetHint: '18:00 이후' });
  });

  it('활동 정보: 단계 수, 마지막 도구 사용, AI 진행 표시를 기록한다', async () => {
    newTask('a1');
    const script =
      "console.log(JSON.stringify({t:'text', v:'[진행 1/3] 읽기'}));" +
      "console.log(JSON.stringify({t:'tool', v:'NOTES.md'}));" +
      "console.log(JSON.stringify({t:'text', v:'[진행 2/3] 쓰기'}));" +
      "console.log(JSON.stringify({t:'done'}))";
    const updates: Task[] = [];
    const r = new TaskRunner(
      store,
      { claude: fakeAdapter(script), codex: fakeAdapter(script) },
      { update: (t) => updates.push(structuredClone(t)), event: () => {} },
      join(base, 'data', 'logs'),
    );
    await r.start('a1');
    const a = store.get('a1')!.activity!;
    expect(a.steps).toBe(3);
    expect(a.lastAction).toBe('Write NOTES.md');
    expect(a.progress).toEqual({ step: 2, total: 3, label: '쓰기' });
    expect(a.lastAt).toBeTruthy();
    // 실행 중에도 화면으로 활동이 전해진다
    expect(updates.some((t) => t.status === 'running' && t.activity?.steps === 1)).toBe(true);
  });

  it('고른 모델을 실행 인자로 넘기고, 출력의 실제 모델을 기록한다', async () => {
    const t = newTask('m1');
    t.models = { claude: 'opus' };
    store.save(t);
    let gotModel: string | undefined;
    const adapter: Adapter = {
      ...fakeAdapter("console.log(JSON.stringify({t:'init'})); console.log(JSON.stringify({t:'done'}))"),
      runArgs: (_p, _c, model) => {
        gotModel = model;
        return ['-e', "console.log(JSON.stringify({t:'init'})); console.log(JSON.stringify({t:'done'}))"];
      },
      parseLine: (l) => {
        const k = JSON.parse(l).t;
        if (k === 'init') return { events: [], model: 'claude-opus-5-5' };
        return k === 'done' ? { events: [], outcome: { status: 'done' } } : { events: [] };
      },
    };
    await new TaskRunner(store, { claude: adapter, codex: adapter }, { update: () => {}, event: () => {} }, join(base, 'data', 'logs')).start('m1');
    expect(gotModel).toBe('opus');
    expect(store.get('m1')!.model).toBe('claude-opus-5-5');
  });

  it('출력에 모델이 없으면 끝난 뒤 어댑터에게 세션의 모델을 물어 기록한다', async () => {
    newTask('m2');
    const adapter: Adapter = { ...fakeAdapter(OK_SCRIPT), modelOfSession: (sid) => (sid === 's-1' ? 'gpt-6-luna' : undefined) };
    await new TaskRunner(store, { claude: adapter, codex: adapter }, { update: () => {}, event: () => {} }, join(base, 'data', 'logs')).start('m2');
    expect(store.get('m2')!.model).toBe('gpt-6-luna');
  });

  it('출력에 사용률 정보가 오면 Emitter.usage로 알린다', async () => {
    newTask('u1');
    const usage = { agent: 'claude' as const, windows: [{ label: '5시간', percent: 56 }], checkedAt: 'now' };
    const withUsage: Adapter = {
      ...fakeAdapter("console.log(JSON.stringify({t:'usage'})); console.log(JSON.stringify({t:'done'}))"),
      parseLine: (l) => {
        const t = JSON.parse(l).t;
        if (t === 'usage') return { events: [], usageInfo: usage };
        return t === 'done' ? { events: [], outcome: { status: 'done' } } : { events: [] };
      },
    };
    const seen: unknown[] = [];
    const r = new TaskRunner(
      store,
      { claude: withUsage, codex: withUsage },
      { update: () => {}, event: () => {}, usage: (u) => seen.push(u) },
      join(base, 'data', 'logs'),
    );
    await r.start('u1');
    expect(seen).toEqual([usage]);
  });

  it('limited 신호 뒤에 성공(done)이 오면 done으로 끝난다', async () => {
    newTask('l3');
    await runner("console.log(JSON.stringify({t:'limit'})); console.log(JSON.stringify({t:'done'}))").start('l3');
    expect(store.get('l3')!.status).toBe('done');
  });

  it('killAll(앱 종료): 실행 중인 프로세스를 끝내고 interrupted로 남긴다', async () => {
    newTask('q1');
    const r = runner('setTimeout(() => {}, 60000)');
    const p = r.start('q1');
    await new Promise((res) => setTimeout(res, 1500));
    r.killAll();
    await p;
    expect(store.get('q1')!.status).toBe('interrupted');
  }, 15000);

  it('worktree를 만드는 동안 취소하면 CLI를 실행하지 않고 cancelled', async () => {
    newTask('c2');
    const r = runner(OK_SCRIPT);
    const p = r.start('c2');
    r.cancel('c2');
    await p;
    expect(store.get('c2')!.status).toBe('cancelled');
    expect(events).toEqual([]);
    expect(existsSync(join(store.get('c2')!.worktree!, 'made.txt'))).toBe(false);
  });

  it('같은 작업을 두 번 시작하면 두 번째는 거부', async () => {
    newTask('d1');
    const r = runner('setTimeout(() => {}, 60000)');
    const p = r.start('d1');
    await expect(r.start('d1')).rejects.toThrow('이미 실행 중');
    r.cancel('d1');
    await p;
    expect(store.get('d1')!.status).toBe('cancelled');
  }, 15000);

  it('출력 줄 해석 중 예외가 나도 작업이 멈추지 않고 그 줄을 raw로 보여준다', async () => {
    newTask('x1');
    const throwing: Adapter = {
      ...fakeAdapter("console.log('boom'); console.log(JSON.stringify({t:'done'}))"),
      parseLine: (l) => {
        if (l === 'boom') throw new Error('parse failed');
        return JSON.parse(l).t === 'done' ? { events: [], outcome: { status: 'done' } } : { events: [] };
      },
    };
    const r = new TaskRunner(store, { claude: throwing, codex: throwing }, { update: () => {}, event: (_id, e) => events.push(e) }, join(base, 'data', 'logs'));
    await r.start('x1');
    expect(store.get('x1')!.status).toBe('done');
    expect(events).toContainEqual({ kind: 'raw', line: 'boom' });
  });

  it('CLI가 설치돼 있지 않으면 worktree를 만들지 않고 failed', async () => {
    newTask('na1');
    const missing: Adapter = { ...fakeAdapter(OK_SCRIPT), isAvailable: () => false };
    const r = new TaskRunner(store, { claude: missing, codex: missing }, { update: () => {}, event: () => {} }, join(base, 'data', 'logs'));
    await r.start('na1');
    expect(store.get('na1')!.status).toBe('failed');
    expect(store.get('na1')!.worktree).toBeUndefined();
    expect(store.get('na1')!.error).toContain('설치돼 있지 않습니다');
    expect(execFileSync('git', ['-C', repo, 'branch', '--list', 'tm/na1'], { encoding: 'utf8' }).trim()).toBe('');
  });

  it('찾을 수 없음(ENOENT)이 아닌 실행 실패는 실행하지 못했다고 표시', async () => {
    newTask('nul1');
    const nul: Adapter = { ...fakeAdapter(''), runArgs: () => ['-e', 'console.log(1)', 'a\u0000b'] };
    const r = new TaskRunner(store, { claude: nul, codex: nul }, { update: () => {}, event: () => {} }, join(base, 'data', 'logs'));
    await r.start('nul1');
    expect(store.get('nul1')!.status).toBe('failed');
    expect(store.get('nul1')!.error).toContain('실행하지 못했습니다');
  });

  it('CLI가 없으면 failed와 안내 문구', async () => {
    newTask('n1');
    const r = new TaskRunner(
      store,
      { claude: { ...fakeAdapter(''), command: () => 'no-such-cli-xyz' }, codex: fakeAdapter('') },
      { update: () => {}, event: () => {} },
      join(base, 'data', 'logs'),
    );
    await r.start('n1');
    expect(store.get('n1')!.status).toBe('failed');
    expect(store.get('n1')!.error).toContain('CLI를 찾을 수 없습니다');
  });

  it('resume: 세션 ID가 없으면 거부, 있으면 같은 worktree에서 다시 실행', async () => {
    newTask('r1');
    const r = runner(OK_SCRIPT);
    store.get('r1')!.status = 'limited';
    await expect(r.resume('r1')).rejects.toThrow('이어서 할 수 없는');
    await r.start('r1');
    const wt = store.get('r1')!.worktree;
    store.get('r1')!.status = 'limited';
    await r.resume('r1');
    expect(store.get('r1')).toMatchObject({ status: 'done', worktree: wt });
    expect(store.get('r1')!.usage.tokens).toBe(20);
  });

  it('글 조각(stream_event) 줄은 화면에만 쓰고 기록 파일에는 남기지 않는다', async () => {
    newTask('s1');
    await runner(`console.log(JSON.stringify({type:'stream_event', event:{}})); console.log(JSON.stringify({t:'text', v:'hi'})); console.log(JSON.stringify({t:'done'}))`).start('s1');
    const log = readFileSync(join(base, 'data', 'logs', 's1.jsonl'), 'utf8');
    expect(log).not.toContain('stream_event');
    expect(log).toContain('"hi"');
  });

  it('시작 준비 중 예상 못 한 오류가 나도 실행 중으로 남지 않고 failed로 끝난다', async () => {
    newTask('x1');
    const broken: Adapter = { ...fakeAdapter(OK_SCRIPT), runArgs: () => { throw new Error('인자 오류'); } };
    const r = new TaskRunner(store, { claude: broken, codex: broken }, { update: () => {}, event: () => {} }, join(base, 'data', 'logs'));
    await r.start('x1');
    expect(r.isRunning('x1')).toBe(false);
    expect(store.get('x1')).toMatchObject({ status: 'failed', error: expect.stringContaining('인자 오류') });
  });

  it('이어서 지시(설계 18절): 메시지를 어댑터에 넘기고, 기록에 사용자 메시지로 남긴다', async () => {
    newTask('f1');
    let sent: string | undefined;
    const adapter: Adapter = { ...fakeAdapter(OK_SCRIPT), resumeArgs: (_s, _c, _m, message) => ((sent = message), ['-e', OK_SCRIPT]) };
    const r = new TaskRunner(store, { claude: adapter, codex: adapter }, { update: () => {}, event: (_id, e) => events.push(e) }, join(base, 'data', 'logs'));
    await r.start('f1');
    await expect(r.resume('f1', '   ')).rejects.toThrow('메시지를 입력하세요');
    await r.resume('f1', ' 테스트도 추가해줘 ');
    expect(sent).toBe('테스트도 추가해줘');
    expect(store.get('f1')!.status).toBe('done');
    expect(events).toContainEqual({ kind: 'user', text: '테스트도 추가해줘' });
    expect(r.readEvents('f1')).toContainEqual({ kind: 'user', text: '테스트도 추가해줘' });
  });

  it('cleanup: 실행 중이면 거부, 끝났으면 worktree와 브랜치 삭제', async () => {
    newTask('k1');
    const r = runner('setTimeout(() => {}, 60000)');
    const p = r.start('k1');
    await new Promise((res) => setTimeout(res, 1500));
    await expect(r.cleanup('k1')).rejects.toThrow('실행 중');
    r.cancel('k1');
    await p;
    const wt = store.get('k1')!.worktree!;
    await r.cleanup('k1');
    expect(existsSync(wt)).toBe(false);
    expect(store.get('k1')!.worktree).toBeUndefined();
  }, 15000);
});

describe('resolveOutcome', () => {
  it('done인데 종료 코드가 0이 아니면 failed', () => {
    expect(resolveOutcome({ status: 'done' }, 2, 'oops')).toEqual({ status: 'failed', message: 'oops' });
  });
  it('결과가 없고 코드 0이면 done', () => {
    expect(resolveOutcome(undefined, 0, '')).toEqual({ status: 'done' });
  });
  it('Codex MCP 인증 잡음(rmcp)은 stderr에서 빼고, 로그인 문제로 오인하지 않는다', () => {
    const noise = 'ERROR rmcp::transport::worker: AuthRequired { www_authenticate_header: "Bearer" }';
    const o = resolveOutcome(undefined, 1, `${noise}\nreal failure`);
    expect(o).toEqual({ status: 'failed', message: 'real failure' });
  });
  it('로그인 문제로 실패하면 터미널 로그인 안내를 붙인다', () => {
    const o = resolveOutcome(undefined, 1, 'Error: not logged in');
    expect(o.status).toBe('failed');
    expect('message' in o && o.message).toContain('터미널에서 claude 또는 codex에 로그인하세요');
  });
});

describe('promptFor', () => {
  it('합의된 계획이 있으면 지시문 뒤에 붙인다', () => {
    const t = { prompt: '고쳐줘', consult: { opinions: {}, decision: { assignee: 'codex', reason: 'r', plan: '1. 테스트' } } } as unknown as Task;
    expect(promptFor(t)).toBe('고쳐줘\n\n합의된 계획:\n1. 테스트');
  });
  it('진행 표시 요청이 켜져 있으면 지시문 끝에 붙인다', () => {
    const t = { prompt: '고쳐줘', progressHint: true } as unknown as Task;
    expect(promptFor(t)).toBe(`고쳐줘\n\n${PROGRESS_HINT}`);
  });
  it('계획이 비어 있으면 지시문만', () => {
    const t = { prompt: '고쳐줘', consult: { opinions: {}, decision: { assignee: 'codex', reason: 'r', plan: '' } } } as unknown as Task;
    expect(promptFor(t)).toBe('고쳐줘');
  });
});
