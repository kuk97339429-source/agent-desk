import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent, Overview, Task } from '../../shared/types';
import { ExternalDetail, ExternalList, externalKey } from './External';
import { NewTaskDialog } from './NewTaskDialog';
import { ProgressView } from './ProgressView';
import { type Queued, applyDrafts, applyEvents } from './format';
import { TaskDetail } from './TaskDetail';
import { TaskList } from './TaskList';
import { UsagePanel } from './UsagePanel';

type Selection = { kind: 'task'; id: string } | { kind: 'ext'; key: string } | null; // null = 진행 현황

const EMPTY: Overview = {
  external: { claude: [], codex: [] },
  usage: [],
  accounts: { claude: { plan: null, models: [], extraUsage: null }, codex: { plan: null, models: [], extraUsage: null } },
};
const POLL_MS = 5000; // 설계 10절: 파일 감시 대신 5초마다 다시 읽는다
const FLUSH_MS = 50; // 글 조각이 초당 수십 번 와도 화면은 이 간격으로 한 번만 다시 그린다
const MAX_EVENTS = 1000; // 작업마다 화면 메모리에 두는 최근 기록 수
const isLive = (t: Task) => t.status === 'running' || t.status === 'consulting';

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<Selection>(null);
  const [events, setEvents] = useState<Record<string, AgentEvent[]>>({});
  const [overview, setOverview] = useState<Overview>(EMPTY);
  const [creating, setCreating] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sideOpen, setSideOpen] = useState(false); // 좁은 창에서만 쓰는 사이드바 열림 상태
  const queue = useRef<Queued[]>([]);
  // 사용량·요금제·외부 세션을 다시 읽는다. 5초마다 자동으로, 사용량 칸의 [새로고침]으로 바로.
  // 값이 그대로면 이전 객체를 유지해 화면 전체를 다시 그리지 않는다
  const refresh = useCallback(
    () =>
      window.desk
        .overview()
        .then((o) => setOverview((prev) => (JSON.stringify(prev) === JSON.stringify(o) ? prev : o)))
        .catch(() => {}),
    [],
  );
  const menuBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    window.desk.listTasks().then(setTasks).catch(() => {});
    const offU = window.desk.onTaskUpdate((t) => {
      setTasks((prev) => [t, ...prev.filter((p) => p.id !== t.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      // 취소·실패·한도로 끝나면 완성된 글이 오지 않으므로 쓰는 중 표시를 여기서 지운다
      if (!isLive(t)) setDrafts((prev) => (t.id in prev ? (({ [t.id]: _, ...rest }) => rest)(prev) : prev));
    });
    // 설계 16절: 들어온 이벤트를 모아 두었다가 FLUSH_MS마다 한 번에 반영한다
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      const q = queue.current;
      queue.current = [];
      setDrafts((prev) => applyDrafts(prev, q));
      setEvents((prev) => applyEvents(prev, q, MAX_EVENTS));
    };
    const offE = window.desk.onTaskEvent((id, e) => {
      queue.current.push([id, e]);
      timer ??= setTimeout(flush, FLUSH_MS);
    });
    refresh();
    const poll = setInterval(refresh, POLL_MS);
    return () => {
      offU();
      offE();
      clearInterval(poll);
      clearTimeout(timer);
    };
  }, [refresh]);

  // 좁은 창의 사이드바: Escape로 닫고 포커스를 메뉴 버튼으로 돌려준다
  useEffect(() => {
    if (!sideOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setSideOpen(false);
      menuBtn.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sideOpen]);

  const loadEvents = async (id: string) => {
    const past = (await window.desk.getEvents(id).catch(() => [] as AgentEvent[])).slice(-MAX_EVENTS);
    // 파일 기록이 화면에 모인 실시간 이벤트보다 짧으면(읽는 사이 새 이벤트가 옴) 화면 쪽을 유지한다
    // ponytail: 길이 비교 근사. 정확히 하려면 이벤트에 순번을 붙여 합친다
    setEvents((prev) => ({ ...prev, [id]: (prev[id]?.length ?? 0) > past.length ? prev[id] : past }));
  };

  const select = (s: Selection) => {
    setSelected(s);
    setSideOpen(false);
  };

  const selectTask = (id: string) => {
    select({ kind: 'task', id });
    void loadEvents(id);
  };

  const narrow = useNarrow();
  const task = selected?.kind === 'task' ? tasks.find((t) => t.id === selected.id) : undefined;
  const ext =
    selected?.kind === 'ext'
      ? [...(overview.external.claude ?? []), ...(overview.external.codex ?? [])].find((s) => externalKey(s) === selected.key)
      : undefined;

  return (
    <div className={`layout${sideOpen ? ' side-open' : ''}`}>
      <button ref={menuBtn} className="menu-btn" aria-expanded={sideOpen} aria-controls="sidebar" onClick={() => setSideOpen(!sideOpen)}>
        {sideOpen ? '닫기' : '메뉴'}
      </button>
      {sideOpen && <div className="backdrop" onClick={() => setSideOpen(false)} />}
      {/* 좁은 창에서 접혀 있을 때는 키보드·화면 읽기에서 빠지게 한다(넓은 창에서는 menu-btn이 숨어 있어 sideOpen과 무관하게 보여야 함) */}
      <aside id="sidebar" className="sidebar" inert={narrow && !sideOpen}>
        <UsagePanel usage={overview.usage} accounts={overview.accounts} onRefresh={refresh} />
        <div className="side-head">
          <button className={selected === null ? 'primary' : ''} onClick={() => select(null)}>
            진행 현황 ({tasks.filter(isLive).length})
          </button>
        </div>
        <TaskList tasks={tasks} selected={task?.id ?? null} onSelect={selectTask} onNew={() => setCreating(true)} />
        <ExternalList
          external={overview.external}
          selected={selected?.kind === 'ext' ? selected.key : null}
          onSelect={(key) => select({ kind: 'ext', key })}
        />
      </aside>
      <main className="detail">
        {task && <TaskDetail key={task.id} task={task} events={events[task.id] ?? []} draft={drafts[task.id]} />}
        {ext && <ExternalDetail s={ext} />}
        {!task && !ext && (
          <ProgressView tasks={tasks} events={events} drafts={drafts} onSelect={selectTask} onLoad={(id) => void loadEvents(id)} />
        )}
      </main>
      {creating && (
        <NewTaskDialog
          accounts={overview.accounts}
          usage={overview.usage}
          tasks={tasks}
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            setCreating(false);
            select({ kind: 'task', id: t.id });
          }}
        />
      )}
    </div>
  );
}

// styles.css의 좁은 창 기준(860px)과 같아야 한다
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 860px)').matches);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 860px)');
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}
