import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import type { AgentEvent, AgentId, AgentUsage, NewTaskInput, Overview, Task } from '../shared/types';
import { readClaudeSessions, readCodexSessions } from './external';
import { spawn } from 'node:child_process';
import { readClaudeAccount, readCodexAccount } from './account';
import { findCodexExe } from './codex';
import { checkTaskInput, consultBlocked, sessionCommand, usageGuard } from './guard';
import { newerUsage, readCodexUsage, readLiveUsage } from './quota';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import { Consultant } from './consultant';
import { type Emitter, TaskRunner } from './runner';
import { TaskStore } from './taskStore';
import { isDirty, repoRoot } from './worktree';

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.on('closed', () => {
    win = null;
  });
  // AI 출력에 섞인 링크로 새 창을 열거나 다른 페이지로 이동하지 않게 막는다
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

const safe = <T>(read: () => T): T | null => {
  try {
    return read();
  } catch {
    return null;
  }
};

const showFailure = (title: string) => (err: Error) => dialog.showErrorBox(title, err.message);

// 두 번 실행하면 두 앱이 tasks.json을 서로 덮어쓰고, 서로의 실행 중 작업을 중단으로 표시한다
// app.quit()은 비동기라 아래 whenReady가 두 번째 앱에서도 돌 수 있다. 바로 끝낸다
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  const dataDir = app.getPath('userData');
  const store = new TaskStore(join(dataDir, 'tasks.json'));
  store.markInterrupted();
  const adapters = { claude: claudeAdapter, codex: codexAdapter };
  // agent-desk가 Claude를 실행할 때만 Pro 사용률이 들어오므로 마지막 값을 파일에 남긴다(설계 11절)
  const quotaFile = join(dataDir, 'quota.json');
  let claudeUsage: AgentUsage | null = null;
  try {
    const saved = JSON.parse(readFileSync(quotaFile, 'utf8')) as AgentUsage;
    if (Array.isArray(saved?.windows) && typeof saved.checkedAt === 'string') claudeUsage = saved;
  } catch {
    // 아직 기록 없음
  }
  const emitter: Emitter = {
    update: (t: Task) => send('task:update', t),
    event: (id: string, e: AgentEvent) => send('task:event', id, e),
    usage: (u: AgentUsage) => {
      claudeUsage = u;
      try {
        writeFileSync(quotaFile, JSON.stringify(u));
      } catch {
        // 저장 실패는 다음 갱신 때 다시 시도
      }
    },
  };
  const logDir = join(dataDir, 'logs');
  const runner = new TaskRunner(store, adapters, emitter, logDir);
  const consultant = new Consultant(store, adapters, emitter, undefined, logDir);
  // Windows는 앱이 끝나도 자식 CLI를 죽이지 않는다. 남은 작업은 다음 실행 때 interrupted로 보인다
  app.on('before-quit', () => runner.killAll());

  const mustGet = (id: string): Task => {
    const t = store.get(id);
    if (!t) throw new Error(`작업을 찾을 수 없습니다: ${id}`);
    return t;
  };

  ipcMain.handle('listTasks', () => store.list());
  ipcMain.handle('getEvents', (_e, id: string) => runner.readEvents(id));

  ipcMain.handle('createTask', async (_e, input: NewTaskInput) => {
    checkTaskInput(input);
    const prompt = input.prompt.trim();
    const root = await repoRoot(input.repo);
    if (!root) throw new Error('git 저장소가 아닙니다');
    const consult = input.agent === 'consult';
    const blocked = consultBlocked(currentUsage());
    if (consult && blocked.length === 2) throw new Error('두 AI 모두 구독 사용률이 90%를 넘었습니다. 직접 세션을 열어 관리하세요.');
    if (!consult) assertUsable(input.agent as AgentId);
    const task: Task = {
      id: randomUUID().slice(0, 8),
      repo: root,
      prompt,
      agent: consult ? null : (input.agent as AgentId),
      models: input.models,
      progressHint: input.progressHint !== false, // 기본 켬(설계 15절 B)
      status: consult ? 'consulting' : 'running',
      usage: {},
      createdAt: new Date().toISOString(),
    };
    store.save(task);
    emitter.update(task);
    if (consult) consultant.consult(task.id, blocked).catch(showFailure('상의 실패'));
    else runner.start(task.id).catch(showFailure('작업 실행 실패'));
    return task;
  });

  ipcMain.handle('confirmTask', (_e, id: string, agent: AgentId) => {
    if (agent !== 'claude' && agent !== 'codex') throw new Error('알 수 없는 AI입니다');
    const task = mustGet(id);
    if (task.status !== 'consulting') throw new Error('상의 중인 작업만 확정할 수 있습니다');
    assertUsable(agent);
    task.agent = agent;
    store.save(task);
    // start()가 첫 await 전에 상태를 running으로 바꾸므로, 두 번 눌러도 두 번째는 위 검사에서 막힌다
    runner.start(id).catch(showFailure('작업 실행 실패'));
  });

  ipcMain.handle('cancelTask', (_e, id: string) => {
    const task = mustGet(id);
    if (runner.isRunning(id)) return runner.cancel(id);
    if (task.status === 'consulting') {
      task.status = 'cancelled';
      task.endedAt = new Date().toISOString();
      store.save(task);
      emitter.update(task);
    }
  });

  ipcMain.handle('resumeTask', (_e, id: string, message?: unknown) => {
    // 화면에서 온 값이라 형식을 다시 확인한다. 실행은 기다리지 않으므로 입력 오류는 여기서 바로 돌려준다
    if (message !== undefined && (typeof message !== 'string' || !message.trim())) throw new Error('메시지를 입력하세요');
    if (typeof message === 'string' && message.length > 20_000) throw new Error('메시지가 너무 깁니다 (2만 자 이하)');
    const task = mustGet(id);
    if (task.agent) assertUsable(task.agent);
    runner.resume(id, message).catch(showFailure('이어서 하기 실패'));
  });
  ipcMain.handle('cleanupTask', (_e, id: string, discard?: unknown) => runner.cleanup(id, discard === true));
  ipcMain.handle('openFolder', async (_e, id: string) => {
    const wt = mustGet(id).worktree;
    if (wt) await shell.openPath(wt);
  });
  ipcMain.handle('pickRepo', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('checkRepo', async (_e, repo: string) => {
    const root = await repoRoot(repo);
    return { root, dirty: root ? await isDirty(root) : false };
  });
  ipcMain.handle('paidKeys', () => ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'].filter((k) => process.env[k]));
  const home = homedir();
  const codexHome = join(home, '.codex');
  const currentUsage = (): Partial<Record<AgentId, AgentUsage>> => {
    // 세 곳 중 가장 최근 값: agent-desk 실행 기록, Claude 자체 캐시, 상태 표시줄 중계(설계 17절)
    // 외부 파일 하나가 깨져도 화면과 보내기가 멈추지 않게, 읽기 실패한 곳은 '모름'으로 둔다
    const claude = [safe(() => readClaudeAccount(join(home, '.claude.json')).usage), safe(() => readLiveUsage(join(home, '.claude', 'agent-desk-usage.json')))].reduce(newerUsage, claudeUsage);
    const codex = safe(() => readCodexUsage(codexHome));
    return { ...(claude && { claude }), ...(codex && { codex }) };
  };
  // 설계 14절: 화면이 막아도 메인 프로세스에서 한 번 더 검사한다
  const assertUsable = (agent: AgentId) => {
    const g = usageGuard(currentUsage()[agent]);
    if (g.level === 'block') {
      throw new Error(`${agent}의 구독 사용률이 ${g.window} ${g.percent}%라 보내지 않았습니다. 직접 세션을 열어 관리하세요.`);
    }
  };

  ipcMain.handle('overview', (): Overview => {
    const unknown = { plan: null, models: [], extraUsage: null };
    const claudeAcct = safe(() => readClaudeAccount(join(home, '.claude.json'))) ?? unknown;
    const codexAcct = safe(() => readCodexAccount(codexHome)) ?? unknown;
    const usage = currentUsage();
    return {
      external: { claude: safe(() => readClaudeSessions(join(home, '.claude'))), codex: safe(() => readCodexSessions(codexHome)) },
      usage: [usage.claude, usage.codex].filter((u): u is AgentUsage => !!u),
      accounts: {
        claude: { plan: claudeAcct.plan, models: claudeAcct.models, extraUsage: claudeAcct.extraUsage },
        codex: { plan: codexAcct.plan, models: codexAcct.models, extraUsage: codexAcct.extraUsage },
      },
    };
  });

  ipcMain.handle('openSession', async (_e, agent: AgentId, cwd: string, sessionId?: string) => {
    if (agent !== 'claude' && agent !== 'codex') throw new Error('알 수 없는 AI입니다');
    const root = await repoRoot(cwd); // git 폴더(저장소나 작업 worktree)에서만 연다
    if (!root) throw new Error('git 저장소 폴더가 아닙니다');
    const exe = agent === 'claude' ? 'claude' : (findCodexExe() ?? 'codex');
    const s = sessionCommand(agent, cwd, sessionId, exe);
    spawn(s.cmd, s.args, { cwd: s.cwd, shell: false, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  });

  createWindow();
});

app.on('window-all-closed', () => app.quit());
