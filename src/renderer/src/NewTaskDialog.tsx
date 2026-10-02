import { useEffect, useState } from 'react';
import { usageGuard } from '../../shared/guard';
import type { AgentId, AgentUsage, Overview, Task } from '../../shared/types';
import { errorText } from './format';
import { AGENT_NAME } from './TaskList';

// 배포용: 처음에는 비워 두고 [찾기]로 고른 저장소를 기억한다
const DEFAULT_REPO = '';
const REPO_KEY = 'agent-desk:lastRepo';

function loadRepo(): string {
  try {
    return localStorage.getItem(REPO_KEY) ?? DEFAULT_REPO;
  } catch {
    return DEFAULT_REPO;
  }
}

export function NewTaskDialog(props: {
  accounts: Overview['accounts'];
  usage: AgentUsage[];
  onClose: () => void;
  onCreated: (t: Task) => void;
}) {
  const [repo, setRepo] = useState(loadRepo);
  const [agent, setAgent] = useState<AgentId | 'consult'>('consult');
  const [models, setModels] = useState<Partial<Record<AgentId, string>>>({});
  // 상의 모드는 두 AI 모두, 직접 지정이면 그 AI만 모델을 고른다
  const modelAgents: AgentId[] = agent === 'consult' ? ['claude', 'codex'] : [agent];
  // 설계 14절: 80% 이상 경고, 90% 이상 보내기 막음(상의는 둘 다 막혔을 때만)
  const guards = modelAgents.map((a) => ({ agent: a, ...usageGuard(props.usage.find((u) => u.agent === a)) }));
  const blocked = guards.filter((g) => g.level === 'block');
  const sendBlocked = agent === 'consult' ? blocked.length === 2 : blocked.length === 1;
  const extraOn = modelAgents.filter((a) => props.accounts[a].extraUsage);
  const [prompt, setPrompt] = useState('');
  const [check, setCheck] = useState<{ root: string | null; dirty: boolean } | null>(null);
  const [paid, setPaid] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true; // 늦게 도착한 이전 경로의 결과는 버린다
    window.desk.checkRepo(repo).then((r) => current && setCheck(r));
    return () => {
      current = false;
    };
  }, [repo]);
  useEffect(() => {
    window.desk.paidKeys().then(setPaid);
  }, []);

  const submit = async () => {
    setError('');
    try {
      const chosen = Object.fromEntries(modelAgents.filter((a) => models[a]).map((a) => [a, models[a]]));
      const t = await window.desk.createTask({ repo, prompt, agent, models: chosen });
      try {
        localStorage.setItem(REPO_KEY, repo);
      } catch {
        // 저장 실패해도 동작에는 영향 없음
      }
      props.onCreated(t);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const pick = async () => {
    const r = await window.desk.pickRepo();
    if (r) setRepo(r);
  };

  return (
    <div className="modal">
      <div className="dialog">
        <h3>새 작업</h3>
        <label className="field">
          저장소
          <div className="row">
            <input value={repo} onChange={(e) => setRepo(e.target.value)} />
            <button onClick={pick}>찾기</button>
          </div>
        </label>
        {check && !check.root && <p className="err">git 저장소가 아닙니다.</p>}
        {check?.dirty && <p className="warn">커밋하지 않은 변경이 있습니다. 이 변경은 작업에 포함되지 않습니다.</p>}

        <div className="agents" role="radiogroup" aria-label="담당 AI">
          {(['consult', 'claude', 'codex'] as const).map((a) => (
            <label key={a} className={`agent-${a === 'consult' ? 'none' : a}${agent === a ? ' on' : ''}`}>
              <input type="radio" name="agent" checked={agent === a} onChange={() => setAgent(a)} />
              {a === 'consult' ? '상의해서 정하기' : a === 'claude' ? 'Claude' : 'Codex'}
            </label>
          ))}
        </div>

        <div className="row">
          {modelAgents.map((a) => (
            <label key={a} className={`field agent-${a}`} style={{ flex: 1 }}>
              {AGENT_NAME[a]} 모델
              <select value={models[a] ?? ''} onChange={(e) => setModels({ ...models, [a]: e.target.value })}>
                {(props.accounts[a].models.length ? props.accounts[a].models : [{ value: '', label: '기본 설정' }]).map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {agent === 'consult' && <p className="muted">의견을 물을 때는 기본 설정 모델을 쓰고, 고른 모델은 실제 작업에 씁니다.</p>}

        <label className="field">
          맡길 작업
          <textarea rows={8} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </label>

        {paid.length > 0 && <p className="warn">{paid.join(', ')} 환경변수가 설정돼 있어 구독 대신 종량제로 결제됩니다.</p>}
        {guards
          .filter((g) => g.level !== 'ok')
          .map((g) => (
            <p key={g.agent} className={g.level === 'block' ? 'err' : 'warn'}>
              {AGENT_NAME[g.agent]} 구독 사용률이 {g.window} {g.percent}%입니다.{' '}
              {g.level === 'block'
                ? agent === 'consult' && !sendBlocked
                  ? `${AGENT_NAME[g.agent]}는 빼고 다른 AI에게 맡깁니다.`
                  : '여기서는 보내지 않습니다. 직접 세션을 열어 관리하세요.'
                : '보낼 수는 있지만 한도에 가깝습니다.'}
            </p>
          ))}
        {extraOn.length > 0 && (
          <p className="warn">
            {extraOn.map((a) => AGENT_NAME[a]).join(', ')}에 추가 사용이 켜져 있어 한도를 넘으면 실제 요금이 청구될 수 있습니다. Claude는 추가 요금 구간에 들어가는 즉시 멈춥니다.
          </p>
        )}
        {error && <p className="err">{error}</p>}

        <div className="row end">
          {blocked.map((g) => (
            <button key={g.agent} onClick={() => window.desk.openSession(g.agent, repo).catch((e) => setError(errorText(e)))}>
              {AGENT_NAME[g.agent]} 직접 열기
            </button>
          ))}
          <button onClick={props.onClose}>닫기</button>
          <button className="primary" disabled={!prompt.trim() || !check?.root || sendBlocked} onClick={submit}>
            보내기
          </button>
        </div>
      </div>
    </div>
  );
}
