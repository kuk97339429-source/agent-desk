import type { Task } from '../../shared/types';

// IPC로 던진 오류에는 Electron이 "Error invoking remote method 'x': Error: " 접두어를 붙인다
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
}

export function agoText(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const sec = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (sec < 10) return '방금';
  if (sec < 60) return `${sec}초 전`;
  return `${Math.floor(sec / 60)}분 전`;
}

export function resetText(resetsAt: string | undefined, now = Date.now()): string {
  if (!resetsAt) return '';
  const d = new Date(resetsAt);
  if (d.getTime() - now < 24 * 3_600_000) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 초기화`;
  }
  return `${d.getMonth() + 1}월 ${d.getDate()}일 초기화`;
}

export function elapsedText(createdAt: string, endedAt?: string, now = Date.now()): string {
  const sec = Math.max(0, Math.floor(((endedAt ? Date.parse(endedAt) : now) - Date.parse(createdAt)) / 1000));
  if (sec < 60) return `${sec}초`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분`;
  return `${Math.floor(min / 60)}시간 ${min % 60}분`;
}

const RECENT_MS = 10 * 60_000;
const isLive = (t: Task) => t.status === 'running' || t.status === 'consulting';

/** 진행 현황에 띄울 작업(설계 16절): 실행 중·상의 중, 그다음 10분 안에 끝난 작업 */
export function boardTasks(tasks: Task[], now = Date.now()): Task[] {
  const recent = tasks.filter((t) => !isLive(t) && t.endedAt && now - Date.parse(t.endedAt) < RECENT_MS);
  return [...tasks.filter(isLive), ...recent];
}
