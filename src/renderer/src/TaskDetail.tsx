import { useState } from 'react';
import type { AgentEvent, Task } from '../../shared/types';
import { ConsultView } from './ConsultView';
import { EventRow, TaskProgress } from './ProgressView';
import { elapsedText, errorText } from './format';
import { AGENT_NAME, STATUS_LABEL, agentClass, usageText } from './TaskList';

const FINISHED = ['done', 'failed', 'cancelled', 'limited', 'interrupted'];

/** 끝난 작업의 같은 세션에 이어서 지시한다(설계 18절). 같은 작업 폴더에서 이전 대화를 기억한 채 실행된다 */
function FollowUp({ task }: { task: Task }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const send = () => {
    setError('');
    window.desk
      .resumeTask(task.id, text)
      .then(() => setText(''))
      .catch((e) => setError(errorText(e)));
  };
  return (
    <section className="followup">
      <label className="field">
        이어서 지시 <span className="muted">(같은 대화와 작업 폴더에서 이어집니다. Ctrl+Enter로 보내기)</span>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && text.trim() && send()}
          placeholder="예: 방금 만든 함수에 테스트도 추가해줘"
        />
      </label>
      {error && <p className="err">{error}</p>}
      <div className="row end">
        <button className="primary" disabled={!text.trim()} onClick={send}>
          보내기
        </button>
      </div>
    </section>
  );
}

export function TaskDetail({ task, events, draft }: { task: Task; events: AgentEvent[]; draft?: string }) {
  const canResume = (task.status === 'limited' || task.status === 'interrupted') && !!task.sessionId && !!task.worktree;
  const act = (p: Promise<unknown>) => p.catch((err) => alert(errorText(err)));

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

      {task.status === 'running' && <TaskProgress task={task} />}
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

      {(events.length > 0 || draft) && (
        <section className="log">
          {events.map((e, i) => (
            <EventRow key={i} e={e} />
          ))}
          {draft && <div className="log-row log-text draft">{draft}</div>}
        </section>
      )}

      {FINISHED.includes(task.status) && task.agent && task.sessionId && task.worktree && <FollowUp task={task} />}

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
              onClick={() =>
                // 잃을 것이 없으면 바로 정리하고, 커밋하지 않은 결과가 있으면 개수를 보여 주고 한 번 더 묻는다
                window.desk.cleanupTask(task.id).catch((e) => {
                  const msg = errorText(e);
                  if (!msg.includes('커밋하지 않은 변경')) return alert(msg);
                  if (confirm(`${msg}\n\nAI가 만든 결과가 사라집니다. 먼저 [폴더 열기]로 확인하거나 원본에 합치세요.\n그래도 지울까요?`)) {
                    act(window.desk.cleanupTask(task.id, true));
                  }
                })
              }
            >
              정리
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
