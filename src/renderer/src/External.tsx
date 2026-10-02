import type { AgentId, ExternalSession } from '../../shared/types';
import { AGENT_NAME } from './TaskList';

export const externalKey = (s: ExternalSession) => `${s.source}:${s.id}`;

export function ExternalList(props: {
  external: Record<AgentId, ExternalSession[] | null>;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const all = [...(props.external.claude ?? []), ...(props.external.codex ?? [])].sort(
    (a, b) => Number(b.running) - Number(a.running) || b.updatedAt.localeCompare(a.updatedAt),
  );
  const missing = (['claude', 'codex'] as const).filter((a) => props.external[a] === null);
  return (
    <section className="side-section">
      <div className="side-head">
        <h2>다른 곳에서 연 세션</h2>
      </div>
      {all.length === 0 && <p className="empty">열려 있는 세션이 없습니다</p>}
      <ul className="list">
        {all.map((s) => (
          <li
            key={externalKey(s)}
            tabIndex={0}
            className={`agent-${s.source}${externalKey(s) === props.selected ? ' active' : ''}`}
            onClick={() => props.onSelect(externalKey(s))}
            onKeyDown={(e) => e.key === 'Enter' && props.onSelect(externalKey(s))}
          >
            <span className="title">
              <span className={`dot${s.running ? ' live' : ''}`} aria-hidden />
              {s.name}
            </span>
            <span className="sub">
              <span>{s.running ? '진행 중' : '대기'}</span>
              <span>{s.where}</span>
            </span>
          </li>
        ))}
      </ul>
      {missing.length > 0 && <p className="empty">{missing.map((a) => AGENT_NAME[a]).join(', ')} 세션 정보를 찾을 수 없음</p>}
    </section>
  );
}

export function ExternalDetail({ s }: { s: ExternalSession }) {
  return (
    <div className={`task-detail agent-${s.source}`}>
      <h2 className="task-title">{s.name}</h2>
      <dl className="facts">
        <dt>AI</dt>
        <dd>{AGENT_NAME[s.source]}</dd>
        <dt>상태</dt>
        <dd>
          <span className={`dot${s.running ? ' live' : ''}`} aria-hidden />
          {s.running ? '진행 중' : '대기'}
        </dd>
        <dt>실행 위치</dt>
        <dd>{s.where}</dd>
        <dt>폴더</dt>
        <dd className="mono">{s.cwd}</dd>
        <dt>마지막 기록</dt>
        <dd>{new Date(s.updatedAt).toLocaleString('ko-KR')}</dd>
      </dl>
      <p className="notice muted">다른 앱에서 실행 중인 세션이라 여기서는 볼 수만 있습니다.</p>
      {s.lastMessage && (
        <section className="log">
          <div className="log-row log-text">{s.lastMessage}</div>
        </section>
      )}
    </div>
  );
}
