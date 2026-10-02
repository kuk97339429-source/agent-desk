import { useEffect, useState } from 'react';
import type { AgentEvent, Overview, Task } from '../../shared/types';
import { ExternalDetail, ExternalList, externalKey } from './External';
import { NewTaskDialog } from './NewTaskDialog';
import { TaskDetail } from './TaskDetail';
import { TaskList } from './TaskList';
import { UsagePanel } from './UsagePanel';

type Selection = { kind: 'task'; id: string } | { kind: 'ext'; key: string } | null;

const EMPTY: Overview = {
  external: { claude: [], codex: [] },
  usage: [],
  accounts: { claude: { plan: null, models: [], extraUsage: null }, codex: { plan: null, models: [], extraUsage: null } },
};
const POLL_MS = 5000; // 설계 10절: 파일 감시 대신 5초마다 다시 읽는다

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<Selection>(null);
  const [events, setEvents] = useState<Record<string, AgentEvent[]>>({});
  const [overview, setOverview] = useState<Overview>(EMPTY);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    window.desk.listTasks().then(setTasks);
    const offU = window.desk.onTaskUpdate((t) =>
      setTasks((prev) => [t, ...prev.filter((p) => p.id !== t.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    );
    const offE = window.desk.onTaskEvent((id, e) => setEvents((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), e] })));
    const refresh = () => window.desk.overview().then(setOverview).catch(() => {});
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      offU();
      offE();
      clearInterval(timer);
    };
  }, []);

  const selectTask = async (id: string) => {
    setSelected({ kind: 'task', id });
    const past = await window.desk.getEvents(id);
    // 파일 기록이 화면에 모인 실시간 이벤트보다 짧으면(읽는 사이 새 이벤트가 옴) 화면 쪽을 유지한다
    // ponytail: 길이 비교 근사. 정확히 하려면 이벤트에 순번을 붙여 합친다
    setEvents((prev) => ({ ...prev, [id]: (prev[id]?.length ?? 0) > past.length ? prev[id] : past }));
  };

  const task = selected?.kind === 'task' ? tasks.find((t) => t.id === selected.id) : undefined;
  const ext =
    selected?.kind === 'ext'
      ? [...(overview.external.claude ?? []), ...(overview.external.codex ?? [])].find((s) => externalKey(s) === selected.key)
      : undefined;

  return (
    <div className="layout">
      <aside className="sidebar">
        <UsagePanel usage={overview.usage} accounts={overview.accounts} />
        <TaskList tasks={tasks} selected={task?.id ?? null} onSelect={selectTask} onNew={() => setCreating(true)} />
        <ExternalList
          external={overview.external}
          selected={selected?.kind === 'ext' ? selected.key : null}
          onSelect={(key) => setSelected({ kind: 'ext', key })}
        />
      </aside>
      <main className="detail">
        {task && <TaskDetail key={task.id} task={task} events={events[task.id] ?? []} />}
        {ext && <ExternalDetail s={ext} />}
        {!task && !ext && <p className="muted">왼쪽에서 작업이나 세션을 고르거나, 새 작업을 보내세요.</p>}
      </main>
      {creating && (
        <NewTaskDialog
          accounts={overview.accounts}
          usage={overview.usage}
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            setCreating(false);
            setSelected({ kind: 'task', id: t.id });
          }}
        />
      )}
    </div>
  );
}
