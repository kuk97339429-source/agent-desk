import type { AgentId } from '../shared/types';

export { consultBlocked, usageGuard } from '../shared/guard';

const SAFE_ID = /^[A-Za-z0-9-]+$/;
// 모델 이름은 CLI 인자로 그대로 넘어가므로 -로 시작하지 않는 짧은 이름만 받는다(예: opus, claude-opus-5-5, gpt-5.5, opus[1m])
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/;
export const MAX_PROMPT = 20_000; // Windows 명령줄 한계(약 32K자) 아래로

/** 화면(렌더러)에서 온 새 작업 값을 메인 프로세스에서 다시 확인한다 */
export function checkTaskInput(input: { prompt?: unknown; agent?: unknown; models?: unknown }): void {
  if (input.agent !== 'claude' && input.agent !== 'codex' && input.agent !== 'consult') throw new Error('알 수 없는 AI입니다');
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) throw new Error('지시문을 입력하세요');
  if (input.prompt.length > MAX_PROMPT) throw new Error(`지시문이 너무 깁니다 (${MAX_PROMPT.toLocaleString()}자 이하)`);
  if (input.models === undefined) return;
  if (typeof input.models !== 'object' || input.models === null) throw new Error('모델 선택 값이 올바르지 않습니다');
  for (const [agent, model] of Object.entries(input.models)) {
    const ok = (agent === 'claude' || agent === 'codex') && (model === undefined || model === '' || (typeof model === 'string' && SAFE_MODEL.test(model)));
    if (!ok) throw new Error('모델 선택 값이 올바르지 않습니다');
  }
}

/**
 * 공식 도구를 새 터미널 창에서 대화형으로 연다(설계 14절). 세션이 있으면 이어서, 없으면 새로.
 * 셸을 거치지 않도록 인자 배열로 만들고, 세션 ID는 영문·숫자·-만 허용한다.
 */
export function sessionCommand(
  agent: AgentId,
  cwd: string,
  sessionId: string | undefined,
  exe: string,
): { cmd: string; args: string[]; cwd: string } {
  if (sessionId !== undefined && !SAFE_ID.test(sessionId)) throw new Error('세션 ID 형식이 올바르지 않습니다');
  const tool = sessionId ? (agent === 'claude' ? [exe, '--resume', sessionId] : [exe, 'resume', sessionId]) : [exe];
  // start의 첫 인자는 따옴표로 감싸져야 창 제목으로 인식된다. Node는 공백이 든 인자만 따옴표로 감싸므로 제목에 공백을 둔다
  // ponytail: 실행 파일 경로에 공백이 있으면 cmd /k의 따옴표 처리 때문에 깨질 수 있다. 그때는 배치 파일을 거치게 바꾼다
  // 폴더는 명령줄에 넣지 않고 cwd로 넘긴다. 명령줄에 넣으면 & ^ % 같은 문자를 cmd가 해석한다
  return { cmd: 'cmd', args: ['/c', 'start', 'agent-desk 세션', 'cmd', '/k', ...tool], cwd };
}
