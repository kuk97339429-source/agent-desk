import type { AgentId, AgentUsage, Overview } from '../../shared/types';
import { resetText } from './format';
import { AGENT_NAME } from './TaskList';

export function Meter({ percent }: { percent: number }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className={`meter${p >= 80 ? ' over' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p}>
      <span style={{ width: `${p}%` }} />
    </div>
  );
}

function AgentBlock({ agent, usage, plan, extraUsage }: { agent: AgentId; usage?: AgentUsage; plan: string | null; extraUsage: boolean | null }) {
  return (
    <div className={`usage-agent agent-${agent}`}>
      <h3>
        {AGENT_NAME[agent]} <span className="plan">{plan ?? '요금제 확인 불가'}</span>
      </h3>
      {usage ? (
        <>
          {usage.windows.map((w) => (
            <div key={w.label} className="usage-row" title={resetText(w.resetsAt)}>
              <span className="muted">{w.label}</span>
              <Meter percent={w.percent} />
              <span className="pct">{w.percent}%</span>
            </div>
          ))}
          <p className="usage-note">
            {usage.windows.map((w) => resetText(w.resetsAt)).filter(Boolean)[0]}
          </p>
        </>
      ) : (
        <p className="usage-note">
          {agent === 'claude' ? '사용률 정보를 아직 받지 못했습니다' : 'Codex 기록을 찾지 못했습니다'}
        </p>
      )}
      {extraUsage && <p className="usage-note warn">추가 사용이 켜져 있어 한도를 넘으면 실제 요금이 청구될 수 있습니다</p>}
    </div>
  );
}

export function UsagePanel({ usage, accounts }: { usage: AgentUsage[]; accounts: Overview['accounts'] }) {
  return (
    <section className="side-section">
      <div className="side-head">
        <h2>사용량</h2>
      </div>
      <div className="usage">
        {(['claude', 'codex'] as const).map((a) => (
          <AgentBlock key={a} agent={a} plan={accounts[a].plan} extraUsage={accounts[a].extraUsage} usage={usage.find((u) => u.agent === a)} />
        ))}
      </div>
    </section>
  );
}
