const LIMIT_RE = /usage limit|rate limit|limit reached|quota|too many requests|\b429\b|hit your (usage )?limit/i;
const EPOCH_RE = /limit reached\|(\d{10})/i;
const RESET_RE = /(resets?\s+(?:at\s+)?[^.\n|]+|try again (?:in|at)\s+[^.\n]+)/i;

export function resetHintFromEpoch(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 이후`;
}

// ponytail: 문구 기반 감지라 CLI 문구가 바뀌면 놓친다. 판단 원문은 항상 로그에 남으니 그때 정규식만 고친다
export function detectLimit(text: string): { limited: boolean; resetHint?: string } {
  if (!LIMIT_RE.test(text)) return { limited: false };
  const epoch = text.match(EPOCH_RE);
  if (epoch) return { limited: true, resetHint: resetHintFromEpoch(Number(epoch[1])) };
  const reset = text.match(RESET_RE);
  return { limited: true, resetHint: reset?.[1].trim() };
}
