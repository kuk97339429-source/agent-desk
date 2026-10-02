import { progressPercent } from '../../shared/progress';
import type { Task } from '../../shared/types';
import { agoText, elapsedText } from './format';
import { AGENT_NAME, STATUS_LABEL, agentClass } from './TaskList';
import { Meter } from './UsagePanel';

/** 실행 중 작업 하나의 진행 표시(설계 15절). AI가 알려 준 단계가 있으면 %, 없으면 움직이는 막대 */
export function TaskProgress({ task }: { task: Task }) {
  const a = task.activity;
  const p = a?.progress;
  return (
    <div className="run-meter">
      {p ? (
        <Meter percent={progressPercent(p, task.status)} />
      ) : (
        <div className="meter busy" aria-label="진행 중">
          <span />
        </div>
      )}
      <span className="muted">
        {p ? `AI가 알려 준 진행 ${p.step}/${p.total} 단계${p.label ? `: ${p.label}` : ''}` : '단계 정보 없음'}
      </span>
      {a?.lastAction && <span className="mono muted">지금: {a.lastAction}</span>}
      <span className="muted">
        {a ? `${a.steps}단계 진행, 마지막 움직임 ${agoText(a.lastAt)}` : '시작하는 중'}
      </span>
    </div>
  );
}

export function ProgressView({ tasks, onSelect }: { tasks: Task[]; onSelect: (id: string) => void }) {
  const live = tasks.filter((t) => t.status === 'running' || t.status === 'consulting');
  return (
    <div className="task-detail">
      <h2 className="task-title agent-none">진행 현황</h2>
      {live.length === 0 && <p className="muted">지금 실행 중인 작업이 없습니다. 왼쪽에서 새 작업을 보내세요.</p>}
      <ul className="board">
        {live.map((t) => (
          <li key={t.id} className={agentClass(t)} tabIndex={0} onClick={() => onSelect(t.id)} onKeyDown={(e) => e.key === 'Enter' && onSelect(t.id)}>
            <div className="board-head">
              <span className="title">{t.prompt.split('\n')[0]}</span>
              <span className="muted">
                {t.agent ? AGENT_NAME[t.agent] : '담당 미정'} {STATUS_LABEL[t.status]} {elapsedText(t.createdAt)}
              </span>
            </div>
            {t.status === 'running' ? <TaskProgress task={t} /> : <span className="muted">두 AI의 의견을 받는 중입니다</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
