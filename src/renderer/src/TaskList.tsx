import type { AgentId, Task, TaskStatus } from '../../shared/types';
import { elapsedText } from './format';

export const AGENT_NAME: Record<AgentId, string> = { claude: 'Claude', codex: 'Codex' };

export const STATUS_LABEL: Record<TaskStatus, string> = {
  consulting: '상의 중',
  running: '실행 중',
  done: '완료',
  failed: '실패',
  cancelled: '중지됨',
  limited: '한도 도달',
  interrupted: '중단됨',
};

export function usageText(t: Task): string {
  if (t.usage.costUsd !== undefined) return `누적 추정 $${t.usage.costUsd.toFixed(2)}`;
  if (t.usage.tokens !== undefined) return `토큰 ${Math.round(t.usage.tokens / 1000)}k`;
  return '';
}

export const agentClass = (t: Task) => `agent-${t.agent ?? 'none'}`;
const isLive = (t: Task) => t.status === 'running' || t.status === 'consulting';

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
      <ul className="list">
        {props.tasks.map((t) => (
          <li
            key={t.id}
            tabIndex={0}
            className={`${agentClass(t)}${t.id === props.selected ? ' active' : ''}`}
            onClick={() => props.onSelect(t.id)}
            onKeyDown={(e) => e.key === 'Enter' && props.onSelect(t.id)}
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
          </li>
        ))}
      </ul>
    </section>
  );
}
