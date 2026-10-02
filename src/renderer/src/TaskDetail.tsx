import { useState } from 'react';
import type { AgentEvent, Task } from '../../shared/types';
import { ConsultView } from './ConsultView';
import { elapsedText, errorText } from './format';
import { AGENT_NAME, STATUS_LABEL, agentClass, usageText } from './TaskList';

function EventRow({ e }: { e: AgentEvent }) {
  const [open, setOpen] = useState(false);
  if (e.kind === 'text') return <div className="log-row log-text">{e.text}</div>;
  if (e.kind === 'tool')
    return (
      <div className="log-row log-tool" onClick={() => setOpen(!open)} title="눌러서 전체 보기">
        <b>{e.name}</b>
        {open ? e.detail : e.detail.slice(0, 100)}
      </div>
    );
  if (e.kind === 'error') return <div className="log-row log-error">{e.message}</div>;
  return <div className="log-row log-raw">{e.line}</div>;
}

const FINISHED = ['done', 'failed', 'cancelled', 'limited', 'interrupted'];

export function TaskDetail({ task, events }: { task: Task; events: AgentEvent[] }) {
  const canResume = (task.status === 'limited' || task.status === 'interrupted') && !!task.sessionId && !!task.worktree;
  const act = (p: Promise<unknown>) => p.catch((err) => alert(errorText(err)));
  const tools = events.filter((e) => e.kind === 'tool').length;

  return (
    <div className={`task-detail ${agentClass(task)}`}>
      <h2 className="task-title">{task.prompt.split('\n')[0]}</h2>

      <dl className="facts">
        <dt>담당</dt>
        <dd>{task.agent ? AGENT_NAME[task.agent] : '상의해서 정하는 중'}</dd>
        <dt>모델</dt>
        <dd className="mono">
          {task.model ?? (task.agent && task.models?.[task.agent]) ?? (task.status === 'running' ? '확인 중' : '기본 설정')}
        </dd>
        <dt>상태</dt>
        <dd className={task.status === 'failed' ? 'err' : task.status === 'limited' ? 'warn' : ''}>
          {STATUS_LABEL[task.status]}
          {task.resetHint && ` (${task.resetHint} 재개 가능)`}
        </dd>
        <dt>저장소</dt>
        <dd className="mono">{task.repo}</dd>
        {task.branch && (
          <>
            <dt>작업 브랜치</dt>
            <dd className="mono">{task.branch}</dd>
          </>
        )}
        <dt>걸린 시간</dt>
        <dd>{elapsedText(task.createdAt, task.endedAt)}</dd>
        {usageText(task) && (
          <>
            <dt>사용량</dt>
            <dd>{usageText(task)}</dd>
          </>
        )}
      </dl>

      {task.status === 'running' && (
        <div className="run-meter">
          <div className="meter busy" aria-label="실행 중">
            <span />
          </div>
          <span className="muted">도구를 {tools}번 썼습니다. 금액은 작업이 끝나면 나옵니다.</span>
        </div>
      )}
      {task.error && <p className="notice err">{task.error}</p>}

      <div className="actions">
        {task.agent && task.status !== 'running' && task.status !== 'consulting' && (
          <button
            title="공식 도구를 새 터미널 창에서 열어 직접 관리합니다"
            onClick={() => act(window.desk.openSession(task.agent!, task.worktree ?? task.repo, task.worktree ? task.sessionId : undefined))}
          >
            직접 세션 열기
          </button>
        )}
        {task.status === 'running' && (
          <button className="danger" onClick={() => act(window.desk.cancelTask(task.id))}>
            중지
          </button>
        )}
        {canResume && (
          <button className="primary" onClick={() => act(window.desk.resumeTask(task.id))}>
            이어서 하기
          </button>
        )}
      </div>

      {task.status === 'consulting' && <ConsultView task={task} />}

      {events.length > 0 && (
        <section className="log">
          {events.map((e, i) => (
            <EventRow key={i} e={e} />
          ))}
        </section>
      )}

      {FINISHED.includes(task.status) && task.worktree && (
        <section className="decision">
          <p>
            바뀐 파일 {task.changedFiles?.length ?? 0}개 <span className="muted">{task.diffStat}</span>
          </p>
          {!!task.changedFiles?.length && (
            <ul className="files">
              {task.changedFiles.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          <div className="actions">
            <button onClick={() => act(window.desk.openFolder(task.id))}>폴더 열기</button>
            <button
              onClick={() => {
                if (confirm('작업 폴더와 tm/ 브랜치를 지웁니다. 커밋하지 않은 변경은 사라집니다. 계속할까요?')) {
                  act(window.desk.cleanupTask(task.id));
                }
              }}
            >
              정리
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
