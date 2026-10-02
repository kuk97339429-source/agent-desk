import type { AgentId } from '../shared/types';

export { consultBlocked, usageGuard } from '../shared/guard';

const SAFE_ID = /^[A-Za-z0-9-]+$/;

/**
 * 공식 도구를 새 터미널 창에서 대화형으로 연다(설계 14절). 세션이 있으면 이어서, 없으면 새로.
 * 셸을 거치지 않도록 인자 배열로 만들고, 세션 ID는 영문·숫자·-만 허용한다.
 */
export function sessionCommand(
  agent: AgentId,
  cwd: string,
  sessionId: string | undefined,
  exe: string,
): { cmd: string; args: string[] } {
  if (sessionId !== undefined && !SAFE_ID.test(sessionId)) throw new Error('세션 ID 형식이 올바르지 않습니다');
  const tool = sessionId ? (agent === 'claude' ? [exe, '--resume', sessionId] : [exe, 'resume', sessionId]) : [exe];
  // start의 첫 인자는 따옴표로 감싸져야 창 제목으로 인식된다. Node는 공백이 든 인자만 따옴표로 감싸므로 제목에 공백을 둔다
  // ponytail: 실행 파일 경로에 공백이 있으면 cmd /k의 따옴표 처리 때문에 깨질 수 있다. 그때는 배치 파일을 거치게 바꾼다
  return { cmd: 'cmd', args: ['/c', 'start', 'agent-desk 세션', '/D', cwd, 'cmd', '/k', ...tool] };
}
