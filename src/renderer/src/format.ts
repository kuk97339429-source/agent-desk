// IPC로 던진 오류에는 Electron이 "Error invoking remote method 'x': Error: " 접두어를 붙인다
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
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
