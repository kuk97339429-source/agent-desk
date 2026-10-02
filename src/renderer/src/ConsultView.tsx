import type { AgentId, OpinionResult, Task } from '../../shared/types';
import { errorText } from './format';

const NAMES: Record<AgentId, string> = { claude: 'Claude', codex: 'Codex' };
const otherOf = (a: AgentId): AgentId => (a === 'claude' ? 'codex' : 'claude');

function OpinionCard({ who, op }: { who: AgentId; op?: OpinionResult }) {
  return (
    <div className={`opinion agent-${who}`}>
      <h4>{NAMES[who]} 의견</h4>
      {!op && <p>의견을 기다리는 중…</p>}
      {op && 'error' in op && <p className="err">의견을 받지 못함: {op.error}</p>}
      {op && !('error' in op) && (
        <>
          <p>
            추천: <b>{op.fit === 'me' ? NAMES[who] : op.fit === 'other' ? NAMES[otherOf(who)] : '누구든'}</b> · 난이도 {op.difficulty}/5
          </p>
          <p>{op.reason}</p>
          <pre>{op.approach}</pre>
        </>
      )}
    </div>
  );
}

export function ConsultView({ task }: { task: Task }) {
  const c = task.consult;
  const decision = c?.decision;
  const run = (agent: AgentId) => window.desk.confirmTask(task.id, agent).catch((e) => alert(errorText(e)));
  const cancel = () => window.desk.cancelTask(task.id);
  return (
    <section className="consult">
      <div className="opinions">
        <OpinionCard who="claude" op={c?.opinions.claude} />
        <OpinionCard who="codex" op={c?.opinions.codex} />
      </div>
      {decision ? (
        <div className="decision">
          <p>
            결정: <b>{NAMES[decision.assignee]}</b> — {decision.reason}
          </p>
          {decision.plan && <pre>{decision.plan}</pre>}
          <button className="primary" onClick={() => run(decision.assignee)}>이대로 실행</button>
          <button onClick={() => run(otherOf(decision.assignee))}>다른 AI로 실행</button>
          <button onClick={cancel}>취소</button>
        </div>
      ) : c && (Object.keys(c.opinions).length > 0 || c.error) ? (
        <div className="decision">
          {c.error && <p className="err">{c.error}</p>}
          <p>자동으로 정하지 못했습니다. 직접 골라 주세요.</p>
          <button onClick={() => run('claude')}>Claude로 실행</button>
          <button onClick={() => run('codex')}>Codex로 실행</button>
          <button onClick={cancel}>취소</button>
        </div>
      ) : (
        <div className="decision">
          <p>두 AI의 의견을 받는 중입니다…</p>
          <button onClick={cancel}>취소</button>
        </div>
      )}
    </section>
  );
}
