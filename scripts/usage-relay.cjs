// Claude Code 상태 표시줄 → agent-desk 사용률 중계 (설계 17절)
// Claude Code가 상태 표시줄 명령에 넘겨주는 rate_limits를 ~/.claude/agent-desk-usage.json에 적는다.
// 로그인 토큰을 읽지 않고, 네트워크도 쓰지 않는다.
const fs = require('fs');
const os = require('os');
const path = require('path');

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  let rl = null;
  try {
    rl = JSON.parse(input).rate_limits ?? null;
  } catch {
    // 형식이 바뀌어도 상태 표시줄은 깨지지 않게 한다
  }
  const file = path.join(os.homedir(), '.claude', 'agent-desk-usage.json');
  try {
    // 쓰는 도중에 agent-desk가 읽어도 깨진 JSON을 보지 않게 임시 파일로 쓴 뒤 바꾼다
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ at: new Date().toISOString(), rate_limits: rl }));
    fs.renameSync(`${file}.tmp`, file);
  } catch {
    // 기록 실패는 다음 갱신 때 다시 시도
  }
  const pct = (w) => (w && typeof w.used_percentage === 'number' ? `${Math.round(w.used_percentage)}%` : '-');
  process.stdout.write(rl ? `사용량 5시간 ${pct(rl.five_hour)} · 7일 ${pct(rl.seven_day)}` : '');
});
