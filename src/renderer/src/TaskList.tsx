import type { KeyboardEvent } from 'react';
import type { AgentId, Task, TaskStatus } from '../../shared/types';
import { elapsedText, groupTasks, lastLine } from './format';

export const AGENT_NAME: Record<AgentId, string> = { claude: 'Claude', codex: 'Codex' };

export const STATUS_LABEL: Record<TaskStatus, string> = {
  consulting: '상의 중',
  running: '실행 중',
  done: '완료',
  failed: '실패',
  cancelled: '내가 중지함',
  limited: '한도 도달',
  interrupted: '앱 종료로 중단',
};

export function usageText(t: Task): string {
  if (t.usage.costUsd !== undefined) return `API 환산 참고값 $${t.usage.costUsd.toFixed(2)} (구독은 청구 안 됨)`;
  if (t.usage.tokens !== undefined) return `토큰 ${Math.round(t.usage.tokens / 1000)}k`;
  return '';
}

export const agentClass = (t: Task) => `agent-${t.agent ?? 'none'}`;
const isLive = (t: Task) => t.status === 'running' || t.status === 'consulting';

// ↑↓로 목록 안에서 이동한다(묶음이 나뉘어 있어도 한 줄로 이어서). Enter·Space로 연다
function moveFocus(e: KeyboardEvent<HTMLElement>, onOpen: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onOpen();
    return;
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const items = [...(e.currentTarget.closest('.task-groups')?.querySelectorAll<HTMLElement>('[data-task]') ?? [])];
  const i = items.indexOf(e.currentTarget);
  items[e.key === 'ArrowDown' ? Math.min(i + 1, items.length - 1) : Math.max(i - 1, 0)]?.focus();
}

/** 설계 21절: 내가 볼 것부터 묶어서 보여 주고, 줄마다 지금 하는 일이나 내가 할 일 한 줄 */
export function TaskList(props: { tasks: Task[]; selected: string | null; onSelect: (id: string) => void; onNew: () => void }) {
  return (
    <section className="side-section">
      <div className="side-head">
        <h2>작업</h2>
        <button className="primary" onClick={props.onNew}>
          새 작업
        </button>
      </div>
      {props.tasks.length === 0 && <p className="empty">아직 보낸 작업이 없습니다</p>}
      <div className="task-groups">
        {groupTasks(props.tasks).map((g) => (
          <div key={g.key} className={`task-group group-${g.key}`}>
            <h3 className="group-head">
              {g.label} <span className="count">{g.tasks.length}</span>
            </h3>
            <ul className="list">
              {g.tasks.map((t) => (
                <li
                  key={t.id}
                  data-task
                  tabIndex={0}
                  aria-current={t.id === props.selected ? 'true' : undefined}
                  className={`${agentClass(t)}${t.id === props.selected ? ' active' : ''}`}
                  onClick={() => props.onSelect(t.id)}
                  onKeyDown={(e) => moveFocus(e, () => props.onSelect(t.id))}
                >
                  <span className="title">
                    <span className={`dot${isLive(t) ? ' live' : ''}`} aria-hidden />
                    {t.prompt.split('\n')[0]}
                  </span>
                  <span className="sub">
                    <span>{t.agent ? AGENT_NAME[t.agent] : '담당 미정'}</span>
                    <span className={t.status === 'failed' ? 'err' : t.status === 'limited' ? 'warn' : ''}>{STATUS_LABEL[t.status]}</span>
                    <span>{elapsedText(t.createdAt, t.endedAt)}</span>
                  </span>
                  {lastLine(t) && <span className="last-line">{lastLine(t)}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
