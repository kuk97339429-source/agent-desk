import { memo, useEffect, useRef, useState } from 'react';
import { progressPercent } from '../../shared/progress';
import type { AgentEvent, Task } from '../../shared/types';
import { agoText, boardTasks, elapsedText, errorText } from './format';
import { AGENT_NAME, STATUS_LABEL, agentClass } from './TaskList';
import { Meter } from './UsagePanel';

// 기록 줄은 내용이 바뀌지 않으므로 memo로 다시 그리지 않는다
export const EventRow = memo(function EventRow({ e }: { e: AgentEvent }) {
  const [open, setOpen] = useState(false);
  if (e.kind === 'text') return <div className="log-row log-text">{e.text}</div>;
  if (e.kind === 'tool')
    return (
      <button type="button" className="log-row log-tool" aria-expanded={open} onClick={() => setOpen(!open)} title="눌러서 전체 보기">
        <b>{e.name}</b>
        {open ? e.detail : e.detail.slice(0, 100)}
      </button>
    );
  if (e.kind === 'error') return <div className="log-row log-error">{e.message}</div>;
  if (e.kind === 'delta') return null;
  if (e.kind === 'user') return <div className="log-row log-user">나: {e.text}</div>;
  return <div className="log-row log-raw">{e.line}</div>;
});

/** 걸린 시간·마지막 움직임 글자를 1초마다 다시 그린다(설계 16절) */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** 실행 중 작업 하나의 진행 표시(설계 15절). AI가 알려 준 단계가 있으면 %, 없으면 움직이는 막대. now는 부모의 시계 하나를 같이 쓴다 */
export function TaskProgress({ task, now }: { task: Task; now: number }) {
  const a = task.activity;
  const p = a?.progress;
  return (
    <div className="run-meter">
      {p ? (
        <Meter percent={progressPercent(p, task.status)} label="AI가 알려 준 진행률" />
      ) : (
        <div className="meter busy" role="progressbar" aria-label="진행 중(단계 정보 없음)">
          <span />
        </div>
      )}
      <span className="muted">
        {p ? `AI가 알려 준 진행 ${p.step}/${p.total} 단계${p.label ? `: ${p.label}` : ''}` : '단계 정보 없음'}
      </span>
      {a?.lastAction && <span className="mono muted">지금: {a.lastAction}</span>}
      <span className="muted">
        {a ? `${a.steps}단계 진행, 마지막 움직임 ${agoText(a.lastAt, now)}` : '시작하는 중'}
      </span>
    </div>
  );
}

const TAIL = 40; // 칸 하나에 보이는 최근 기록 수
const NO_EVENTS: AgentEvent[] = []; // 매번 새 빈 배열을 만들면 memo가 소용없다

/** 기록 끝을 따라가되, 사용자가 위로 올려 읽는 중이면 그대로 둔다. 1초 시계와 무관하게 기록이 바뀔 때만 다시 그린다 */
const LiveLog = memo(function LiveLog({ events, draft, title }: { events: AgentEvent[]; draft?: string; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events.length, draft]);
  return (
    <div
      className="log panel-log"
      ref={ref}
      role="log"
      aria-label={`${title} 기록`}
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {events.length === 0 && !draft && <p className="muted">아직 기록이 없습니다</p>}
      {events.slice(-TAIL).map((e, i) => (
        <EventRow key={Math.max(0, events.length - TAIL) + i} e={e} />
      ))}
      {draft && <div className="log-row log-text draft">{draft}</div>}
    </div>
  );
});

function Panel(props: { task: Task; events?: AgentEvent[]; draft?: string; now: number; onOpen: () => void; onLoad: () => void }) {
  const { task: t, now } = props;
  const title = t.prompt.split('\n')[0];
  const live = t.status === 'running' || t.status === 'consulting';
  // 처음 띄울 때 한 번만 지난 기록을 읽는다
  useEffect(() => {
    if (!props.events) props.onLoad();
  }, []);
  return (
    <article className={`panel ${agentClass(t)}${live ? '' : ' dim'}`}>
      <header className="panel-head">
        <h3 className="title" title={t.prompt}>
          {t.prompt.split('\n')[0]}
        </h3>
        <span className="muted">
          {t.agent ? AGENT_NAME[t.agent] : '담당 미정'} ·{' '}
          <span className={t.status === 'failed' ? 'err' : t.status === 'limited' ? 'warn' : ''}>{STATUS_LABEL[t.status]}</span> ·{' '}
          {elapsedText(t.createdAt, t.endedAt, now)}
        </span>
      </header>
      {t.status === 'running' && <TaskProgress task={t} now={now} />}
      {t.status === 'consulting' && <p className="muted">두 AI의 의견을 받는 중입니다</p>}
      {!live && (
        <p className={t.status === 'failed' ? 'err' : 'muted'}>
          {t.endedAt && `${agoText(t.endedAt, now)} 끝남`}
          {t.error && ` · ${t.error.split('\n')[0]}`}
        </p>
      )}
      {t.status !== 'consulting' && <LiveLog events={props.events ?? NO_EVENTS} draft={props.draft} title={title} />}
      <div className="actions">
        {t.status === 'running' && (
          <button className="danger" aria-label={`${title} 중지`} onClick={() => window.desk.cancelTask(t.id).catch((e) => alert(errorText(e)))}>
            중지
          </button>
        )}
        <button aria-label={`${title} 상세 보기`} onClick={props.onOpen}>
          상세 보기
        </button>
      </div>
    </article>
  );
}

export function ProgressView(props: {
  tasks: Task[];
  events: Record<string, AgentEvent[]>;
  drafts: Record<string, string>;
  onSelect: (id: string) => void;
  onLoad: (id: string) => void;
}) {
  const now = useNow();
  const board = boardTasks(props.tasks, now);
  return (
    <div className="progress-view">
      <h2 className="task-title agent-none">진행 현황</h2>
      {board.length === 0 && <p className="muted">지금 실행 중인 작업이 없습니다. 왼쪽에서 새 작업을 보내세요.</p>}
      <div className="panels">
        {board.map((t) => (
          <Panel
            key={t.id}
            task={t}
            events={props.events[t.id]}
            draft={props.drafts[t.id]}
            now={now}
            onOpen={() => props.onSelect(t.id)}
            onLoad={() => props.onLoad(t.id)}
          />
        ))}
      </div>
    </div>
  );
}
