import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentId, Task } from '../shared/types';

const FIVE_HOURS = 5 * 60 * 60 * 1000;

export class TaskStore {
  private tasks = new Map<string, Task>();

  constructor(private file: string) {
    if (!existsSync(file)) return;
    try {
      for (const t of JSON.parse(readFileSync(file, 'utf8')) as Task[]) this.tasks.set(t.id, t);
    } catch {
      renameSync(file, `${file}.bak`); // 기록을 덮어쓰지 않도록 보존
    }
  }

  list(): Task[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  save(task: Task): void {
    this.tasks.set(task.id, task);
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.list(), null, 2));
    renameSync(tmp, this.file);
  }

  markInterrupted(now = new Date().toISOString()): void {
    let changed: Task | undefined;
    for (const t of this.tasks.values()) {
      if (t.status === 'running') {
        t.status = 'interrupted';
        t.endedAt = now;
        changed = t;
      } else if (t.status === 'consulting' && !t.consult?.decision) {
        // 상의는 세션이 없어 이어갈 수 없다. 상의 화면에 남겨 두고 직접 고르거나 취소하게 한다
        t.consult = { opinions: t.consult?.opinions ?? {}, error: '앱이 다시 시작돼 상의가 중단됐습니다. 직접 고르거나 취소하세요.' };
        changed = t;
      }
    }
    if (changed) this.save(changed);
  }

  // ponytail: 초기화 시각 문구는 형식이 제각각이라 "최근 5시간 안에 한도로 끝난 작업"으로 근사한다.
  // 초기화 시각이 있는 것만 구독 한도로 본다(작업별 사용량 상한 도달에는 초기화 시각이 없다)
  recentlyLimited(agent: AgentId, now = Date.now(), windowMs = FIVE_HOURS): boolean {
    return this.list().some(
      (t) =>
        t.agent === agent &&
        t.status === 'limited' &&
        !!t.resetHint &&
        t.endedAt !== undefined &&
        now - Date.parse(t.endedAt) < windowMs,
    );
  }
}
