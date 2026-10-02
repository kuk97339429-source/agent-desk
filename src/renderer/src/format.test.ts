import { describe, expect, it } from 'vitest';
import type { Task } from '../../shared/types';
import { agoText, boardTasks, elapsedText, errorText, resetText } from './format';

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
