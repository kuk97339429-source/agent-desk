import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Task } from '../shared/types';
import { TaskStore } from './taskStore';

function task(over: Partial<Task>): Task {
  return { id: 't1', repo: 'C:/r', prompt: 'p', agent: 'claude', status: 'running', usage: {}, createdAt: '2026-10-02T00:00:00Z', ...over };
}

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'store-')), 'tasks.json');

describe('TaskStore', () => {
  it('저장 후 새 인스턴스로 다시 읽는다, 최신이 먼저', () => {
    const f = tmpFile();
    const s = new TaskStore(f);
    s.save(task({ id: 'a', createdAt: '2026-10-01T00:00:00Z' }));
    s.save(task({ id: 'b', createdAt: '2026-10-02T00:00:00Z' }));
    expect(new TaskStore(f).list().map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('markInterrupted: running은 interrupted, 결정 없는 consulting은 그대로 두고 직접 고르라는 안내', () => {
    const f = tmpFile();
    const s = new TaskStore(f);
    s.save(task({ id: 'r', status: 'running' }));
    s.save(task({ id: 'c', status: 'consulting', agent: null, consult: { opinions: {} } }));
    s.save(task({ id: 'd', status: 'done' }));
    s.markInterrupted('2026-10-02T01:00:00Z');
    expect(s.get('r')).toMatchObject({ status: 'interrupted', endedAt: '2026-10-02T01:00:00Z' });
    expect(s.get('c')!.status).toBe('consulting');
    expect(s.get('c')!.consult!.error).toContain('직접 고르거나 취소');
    expect(s.get('d')!.status).toBe('done');
    expect(new TaskStore(f).get('r')!.status).toBe('interrupted'); // 파일에도 반영
  });

  it('recentlyLimited: 해당 AI가 창 안에서 limited로 끝난 작업이 있으면 true', () => {
    const s = new TaskStore(tmpFile());
    const now = Date.parse('2026-10-02T10:00:00Z');
    s.save(task({ id: 'x', agent: 'codex', status: 'limited', resetHint: 'Try again in 2 days', endedAt: '2026-10-02T08:00:00Z' }));
    expect(s.recentlyLimited('codex', now)).toBe(true);
    expect(s.recentlyLimited('claude', now)).toBe(false);
    expect(s.recentlyLimited('codex', now, 60 * 60 * 1000)).toBe(false);
  });

  it('초기화 시각이 없는 limited(작업별 사용량 상한)는 구독 한도로 보지 않는다', () => {
    const s = new TaskStore(tmpFile());
    const now = Date.parse('2026-10-02T10:00:00Z');
    s.save(task({ id: 'b', agent: 'claude', status: 'limited', error: '사용량 상한 도달', endedAt: '2026-10-02T09:00:00Z' }));
    expect(s.recentlyLimited('claude', now)).toBe(false);
  });

  it('깨진 tasks.json은 .bak으로 옮기고 빈 상태로 시작한다', () => {
    const f = tmpFile();
    writeFileSync(f, '{not json');
    const s = new TaskStore(f);
    expect(s.list()).toEqual([]);
    expect(existsSync(`${f}.bak`)).toBe(true);
  });
});
