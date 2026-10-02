# agent-desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code와 Codex에 작업을 보내고(직접 지정 또는 두 AI 상의), 작업별 git worktree에서 실행하며, 진행 상황·사용량·한도 도달 후 재개를 한 화면에서 다루는 개인용 Electron 앱을 만든다.

**Architecture:** Electron 메인 프로세스가 두 CLI(`claude -p`, `codex exec`)를 `shell: false`로 실행하고 JSON 출력 줄을 어댑터로 공통 이벤트로 바꿔 IPC로 화면에 보낸다. 작업 상태는 `tasks.json`, 원본 출력은 `logs/<id>.jsonl`에 저장한다. 화면은 React(Vite)이고 preload가 노출한 `window.desk` API만 쓴다.

**Tech Stack:** Electron, electron-vite, React 18+, TypeScript(strict), Vitest, Node 내장 `child_process`/`readline`/`fs`. 그 외 의존성 추가 금지.

**Spec:** `C:\Users\you\tool_manager\agent-desk\docs\design.md`

## Global Constraints

- 프로젝트 루트: `C:\Users\you\tool_manager\agent-desk\` (새 git 저장소)
- 대상 OS: Windows. 프로세스 트리 종료는 `taskkill /pid <pid> /T /F`
- CLI 실행은 항상 `spawn(cmd, args, { shell: false, stdio: ['ignore','pipe','pipe'], windowsHide: true })`. 지시문은 인자 배열의 한 원소로만 전달
- worktree 위치: `<저장소 상위>/.tm-worktrees/<저장소이름>/<작업ID>`, 브랜치 `tm/<작업ID>`. 원본 저장소 폴더 안에는 아무것도 만들지 않음
- Claude 실행: `--output-format stream-json --verbose --permission-mode acceptEdits --max-budget-usd <상한>`. 기본 상한 `2`, 의견 요청은 `--permission-mode plan`, 상한 `0.3`
- Codex 실행: `exec --json -s workspace-write -C <worktree>`, 의견 요청은 `-s read-only -C <원본 저장소>`
- Codex 실행 파일: `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe` 중 수정 시각이 가장 최근인 것
- 재개 지시문 고정 문구: `이어서 진행해줘`
- 기본 저장소: `C:\Users\you\Capstone`
- 화면 문구는 한국어
- 상태 값: `consulting` | `running` | `done` | `failed` | `cancelled` | `limited` | `interrupted`
- 자동 재개, 자동 merge, 패키징, 설정 화면, 화면 테스트는 만들지 않는다

## Review Focus

1. 지시문이 `-`로 시작하거나 따옴표·줄바꿈·한글을 포함해도 CLI 옵션으로 해석되지 않고 한 덩어리로 전달돼야 한다 → Task 4·5·6 테스트
2. 저장소 경로에 공백이 있어도 worktree 생성·변경 조회·정리가 동작해야 한다 → Task 7 테스트(공백 포함 임시 폴더)
3. CRLF 줄끝이나 JSON이 아닌 출력 줄이 와도 작업이 죽지 않고 원문이 로그에 보여야 한다 → Task 4·5·6 테스트
4. AI가 의견 JSON을 코드펜스나 설명 문장과 섞어 내도 읽혀야 하고, 못 읽으면 그 의견만 실패로 처리돼야 한다 → Task 10 테스트
5. 실행 중인 작업의 [정리], 세션 ID 없는 작업의 [이어서 하기]는 거부돼야 한다 → Task 9 테스트

---

## File Structure

```
agent-desk/
  package.json, tsconfig.json, electron.vite.config.ts, .gitignore
  docs/design.md, docs/plan.md, docs/cli-notes.md (Task 2)
  fixtures/                     CLI 실제 출력 샘플 (Task 2)
  src/shared/types.ts           화면·메인 공용 타입과 DeskApi
  src/main/
    usage.ts                    사용량 합산
    limit.ts                    한도 문구 감지
    process.ts                  CLI 실행 + 줄 단위 출력 + 트리 종료
    adapter.ts                  Adapter 인터페이스, ParsedLine, Outcome
    claude.ts / codex.ts        어댑터 2개
    worktree.ts                 git worktree 다루기
    taskStore.ts                tasks.json 저장소
    runner.ts                   작업 실행·재개·중지·정리
    consultant.ts               상의 모드
    index.ts                    창 생성 + IPC
  src/preload/index.ts          window.desk 노출
  src/renderer/index.html
  src/renderer/src/
    main.tsx, App.tsx, env.d.ts, styles.css
    TaskList.tsx, TaskDetail.tsx, NewTaskDialog.tsx, ConsultView.tsx
```

테스트는 대상 파일 옆에 `*.test.ts`로 둔다.

---

### Task 1: 프로젝트 뼈대

**Files:**
- Create: `package.json`, `tsconfig.json`, `electron.vite.config.ts`, `.gitignore`, `src/shared/types.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/env.d.ts`, `src/renderer/src/styles.css`

**Interfaces:**
- Produces: `src/shared/types.ts`의 모든 타입(이후 모든 Task가 사용)

- [ ] **Step 1: git 저장소와 package.json 만들기**

```bash
cd /c/Users/you/tool_manager/agent-desk
git init
```

`package.json`:

```json
{
  "name": "agent-desk",
  "version": "0.1.0",
  "private": true,
  "main": "out/main/index.js",
  "scripts": {
    "start": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  }
}
```

`"type": "module"`은 넣지 않는다(preload를 CommonJS로 빌드해야 sandbox preload가 동작한다).

- [ ] **Step 2: 의존성 설치**

```bash
npm install react react-dom
npm install -D electron electron-vite vite @vitejs/plugin-react typescript vitest @types/node @types/react @types/react-dom
```

설치 중 electron-vite의 peer dependency 충돌로 실패하면 `npm view electron-vite peerDependencies`로 요구하는 vite 버전을 확인하고 `npm install -D vite@<그 버전>`으로 맞춘 뒤 다시 설치한다.

- [ ] **Step 3: 설정 파일 작성**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "lib": ["ES2022", "DOM"],
    "noEmit": true
  },
  "include": ["src", "electron.vite.config.ts"]
}
```

`electron.vite.config.ts`:

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] },
});
```

`.gitignore`:

```
node_modules/
out/
.spike/
```

- [ ] **Step 4: 공용 타입 작성**

`src/shared/types.ts`:

```ts
export type AgentId = 'claude' | 'codex';

export type TaskStatus =
  | 'consulting'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'limited'
  | 'interrupted';

export type AgentEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; detail: string }
  | { kind: 'error'; message: string }
  | { kind: 'raw'; line: string };

export interface Usage {
  costUsd?: number;
  tokens?: number;
}

export interface Opinion {
  approach: string;
  difficulty: number;
  fit: 'me' | 'other' | 'either';
  reason: string;
}

export type OpinionResult = Opinion | { error: string };

export interface Decision {
  assignee: AgentId;
  reason: string;
  plan: string;
}

export interface Task {
  id: string;
  repo: string;
  prompt: string;
  agent: AgentId | null;
  budgetUsd: number;
  status: TaskStatus;
  worktree?: string;
  branch?: string;
  sessionId?: string;
  usage: Usage;
  changedFiles?: string[];
  diffStat?: string;
  error?: string;
  resetHint?: string;
  consult?: { opinions: Partial<Record<AgentId, OpinionResult>>; decision?: Decision };
  createdAt: string;
  endedAt?: string;
}

export interface NewTaskInput {
  repo: string;
  prompt: string;
  agent: AgentId | 'consult';
  budgetUsd: number;
}

export interface DeskApi {
  listTasks(): Promise<Task[]>;
  getEvents(id: string): Promise<AgentEvent[]>;
  createTask(input: NewTaskInput): Promise<Task>;
  confirmTask(id: string, agent: AgentId): Promise<void>;
  cancelTask(id: string): Promise<void>;
  resumeTask(id: string, budgetUsd?: number): Promise<void>;
  cleanupTask(id: string): Promise<void>;
  openFolder(id: string): Promise<void>;
  pickRepo(): Promise<string | null>;
  checkRepo(repo: string): Promise<{ root: string | null; dirty: boolean }>;
  paidKeys(): Promise<string[]>;
  onTaskUpdate(cb: (task: Task) => void): () => void;
  onTaskEvent(cb: (id: string, event: AgentEvent) => void): () => void;
}
```

- [ ] **Step 5: 최소 창 띄우기**

`src/main/index.ts`:

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
```

`src/preload/index.ts`:

```ts
export {};
```

`src/renderer/index.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <title>agent-desk</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
```

`src/renderer/src/App.tsx`:

```tsx
export function App() {
  return <h1>agent-desk</h1>;
}
```

`src/renderer/src/env.d.ts`:

```ts
import type { DeskApi } from '../../shared/types';

declare global {
  interface Window {
    desk: DeskApi;
  }
}

export {};
```

`src/renderer/src/styles.css`:

```css
body { margin: 0; font-family: 'Segoe UI', 'Malgun Gothic', sans-serif; }
```

- [ ] **Step 6: 확인**

Run: `npm run typecheck` → Expected: 오류 없음
Run: `npm test` → Expected: `No test files found` 후 종료 코드 0
Run: `npm start` → Expected: "agent-desk" 제목이 있는 창이 뜬다. 확인 후 창을 닫는다

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: agent-desk 프로젝트 뼈대"
```

---

### Task 2: CLI 실제 출력 샘플 수집 (설계 9절 확인)

**사용량을 쓰는 단계다. 시작 전에 사용자에게 "Claude 3회, Codex 2회 짧은 실행을 해도 되는지" 확인받는다.**

**Files:**
- Create: `fixtures/claude-run.jsonl`, `fixtures/claude-budget.jsonl`, `fixtures/claude-opinion.jsonl`, `fixtures/codex-run.jsonl`, `fixtures/codex-opinion.jsonl`, `docs/cli-notes.md`

**Interfaces:**
- Produces: Task 5·6 테스트가 읽는 fixture 파일 5개. `docs/cli-notes.md`에 세션 ID·사용량·결과 이벤트의 실제 필드 이름 기록

- [ ] **Step 1: 실험용 저장소 만들기**

```bash
cd /c/Users/you/tool_manager/agent-desk
mkdir -p .spike/repo fixtures
cd .spike/repo
git init
printf '# spike\n\nhello\n' > README.md
git add README.md
git -c user.email=spike@local -c user.name=spike commit -m init
```

- [ ] **Step 2: Claude 일반 실행**

```bash
claude -p "README.md 첫 줄을 읽고 한 문장으로 알려줘" --output-format stream-json --verbose --permission-mode acceptEdits --max-budget-usd 0.2 < /dev/null > ../../fixtures/claude-run.jsonl
```

Expected: `"type":"system"`(subtype `init`, `session_id` 포함)로 시작해 `"type":"result"`로 끝나는 JSON 줄들.

- [ ] **Step 3: Claude 상한 초과 실행 (설계 5절 확인)**

```bash
claude -p "README.md를 읽고 세 문장으로 요약해줘" --output-format stream-json --verbose --permission-mode acceptEdits --max-budget-usd 0.0001 < /dev/null > ../../fixtures/claude-budget.jsonl
```

Expected: `result` 줄의 `subtype`/`is_error`/`result` 값으로 상한 초과가 드러난다. 상한 초과 없이 `success`로 끝나면 구독 로그인에서 상한이 동작하지 않는 것이므로 `docs/cli-notes.md`에 기록하고, Task 9의 `budgetGuard` 대체 구현을 적용한다.

- [ ] **Step 4: Claude 의견 요청 (설계 7절 확인)**

```bash
claude -p '이 저장소의 README를 한국어로 번역하는 작업을 누가 맡는 게 좋은지 판단해라. 다른 말 없이 JSON 한 개만 출력: {"approach":"...","difficulty":1,"fit":"me","reason":"..."}' --output-format stream-json --verbose --permission-mode plan --max-budget-usd 0.3 < /dev/null > ../../fixtures/claude-opinion.jsonl
```

Expected: `result` 줄의 `result` 문자열 안에 JSON이 있다.

- [ ] **Step 5: Codex 일반 실행과 의견 요청**

```bash
codex exec --json -s workspace-write -C "$(pwd)" "README.md 첫 줄을 읽고 한 문장으로 알려줘" < /dev/null > ../../fixtures/codex-run.jsonl
codex exec --json -s read-only -C "$(pwd)" '이 저장소의 README를 한국어로 번역하는 작업을 누가 맡는 게 좋은지 판단해라. 다른 말 없이 JSON 한 개만 출력: {"approach":"...","difficulty":1,"fit":"me","reason":"..."}' < /dev/null > ../../fixtures/codex-opinion.jsonl
```

Expected: `thread.started`(`thread_id`), `item.completed`(`item.type` = `agent_message`), `turn.completed`(`usage`) 줄들. Codex 무료 한도에 걸리면 그 출력을 그대로 저장하고(한도 문구 샘플이 된다) cli-notes에 기록한다.

- [ ] **Step 6: 기록**

`docs/cli-notes.md`에 아래 표를 실제 값으로 채운다(각 칸에 fixture에서 본 필드 경로를 그대로 적는다):

```markdown
# CLI 출력 메모 (YYYY-MM-DD 수집)

| 항목 | Claude | Codex |
|---|---|---|
| 세션 ID | system/init 줄의 `session_id` | thread.started 줄의 `thread_id` |
| 최종 답변 텍스트 | result 줄의 `result` | 마지막 item.completed(agent_message)의 `item.text` |
| 사용량 | result 줄의 `total_cost_usd` | turn.completed 줄의 `usage.input_tokens + usage.output_tokens` |
| 성공 판정 | result `subtype` = `success`, `is_error` = false | turn.completed 존재 |
| 상한/한도 실패 | (claude-budget.jsonl에서 본 subtype/문구) | (본 문구가 있으면) |

- 구독 로그인에서 --max-budget-usd 동작: 멈춤 / 안 멈춤
- plan 모드 의견 JSON: 받음 / 문장 섞임 / 실패
```

위 표의 기본값이 Task 5·6 파서가 가정하는 필드다. 실제 값이 다르면 Task 5·6의 파서와 테스트 샘플을 실제 값에 맞춰 바꾼 뒤 진행한다.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/you/tool_manager/agent-desk
git add fixtures docs/cli-notes.md
git commit -m "chore: CLI 실제 출력 샘플과 메모"
```

---

### Task 3: 사용량 합산과 한도 문구 감지

**Files:**
- Create: `src/main/usage.ts`, `src/main/limit.ts`
- Test: `src/main/usage.test.ts`, `src/main/limit.test.ts`

**Interfaces:**
- Consumes: `Usage` (`src/shared/types.ts`)
- Produces: `addUsage(u: Usage, d?: Usage): void`, `detectLimit(text: string): { limited: boolean; resetHint?: string }`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/main/usage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addUsage } from './usage';

describe('addUsage', () => {
  it('비용과 토큰을 각각 누적한다', () => {
    const u = {};
    addUsage(u, { costUsd: 0.1 });
    addUsage(u, { costUsd: 0.25, tokens: 100 });
    addUsage(u, { tokens: 50 });
    expect(u).toEqual({ costUsd: 0.35, tokens: 150 });
  });

  it('undefined 델타는 무시한다', () => {
    const u = { tokens: 5 };
    addUsage(u, undefined);
    expect(u).toEqual({ tokens: 5 });
  });
});
```

`src/main/limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectLimit } from './limit';

describe('detectLimit', () => {
  it('Claude 에포크 형식에서 초기화 시각을 HH:MM 이후로 만든다', () => {
    const r = detectLimit('Claude AI usage limit reached|1759400000');
    expect(r.limited).toBe(true);
    expect(r.resetHint).toMatch(/^\d{2}:\d{2} 이후$/);
  });

  it('resets 문구를 그대로 힌트로 쓴다', () => {
    const r = detectLimit('5-hour limit reached ∙ resets 3pm');
    expect(r).toEqual({ limited: true, resetHint: 'resets 3pm' });
  });

  it('Codex try again 문구를 감지한다', () => {
    const r = detectLimit("You've hit your usage limit. Try again in 2 days.");
    expect(r.limited).toBe(true);
    expect(r.resetHint).toBe('Try again in 2 days');
  });

  it('429와 rate limit도 한도로 본다', () => {
    expect(detectLimit('HTTP 429 Too Many Requests').limited).toBe(true);
    expect(detectLimit('rate limit exceeded').limited).toBe(true);
  });

  it('일반 오류는 한도가 아니다', () => {
    expect(detectLimit('SyntaxError: unexpected token').limited).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/main/usage.test.ts src/main/limit.test.ts`
Expected: FAIL (`Cannot find module './usage'`, `'./limit'`)

- [ ] **Step 3: 구현**

`src/main/usage.ts`:

```ts
import type { Usage } from '../shared/types';

export function addUsage(u: Usage, d?: Usage): void {
  if (!d) return;
  if (d.costUsd !== undefined) u.costUsd = (u.costUsd ?? 0) + d.costUsd;
  if (d.tokens !== undefined) u.tokens = (u.tokens ?? 0) + d.tokens;
}
```

`src/main/limit.ts`:

```ts
const LIMIT_RE = /usage limit|rate limit|limit reached|quota|too many requests|\b429\b|hit your (usage )?limit/i;
const EPOCH_RE = /limit reached\|(\d{10})/i;
const RESET_RE = /(resets?\s+(?:at\s+)?[^.\n|]+|try again (?:in|at)\s+[^.\n]+)/i;

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ponytail: 문구 기반 감지라 CLI 문구가 바뀌면 놓친다. 판단 원문은 항상 로그에 남으니 그때 정규식만 고친다
export function detectLimit(text: string): { limited: boolean; resetHint?: string } {
  if (!LIMIT_RE.test(text)) return { limited: false };
  const epoch = text.match(EPOCH_RE);
  if (epoch) return { limited: true, resetHint: `${hhmm(new Date(Number(epoch[1]) * 1000))} 이후` };
  const reset = text.match(RESET_RE);
  return { limited: true, resetHint: reset?.[1].trim() };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/main/usage.test.ts src/main/limit.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/usage.ts src/main/usage.test.ts src/main/limit.ts src/main/limit.test.ts
git commit -m "feat: 사용량 합산과 한도 문구 감지"
```

---

### Task 4: CLI 실행과 줄 단위 출력

**Files:**
- Create: `src/main/process.ts`
- Test: `src/main/process.test.ts`

**Interfaces:**
- Produces:
  - `interface RunResult { code: number | null; stderr: string; spawnError?: string }`
  - `interface RunHandle { kill(): void; done: Promise<RunResult> }`
  - `runProcess(cmd: string, args: string[], cwd: string, onLine: (line: string) => void): RunHandle`
  - `killTree(pid?: number): void`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/main/process.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { runProcess } from './process';

const node = process.execPath;

describe('runProcess', () => {
  it('stdout을 줄 단위로 넘기고 CRLF의 \\r을 제거한다', async () => {
    const lines: string[] = [];
    const h = runProcess(node, ['-e', "process.stdout.write('a\\r\\nb\\nc')"], tmpdir(), (l) => lines.push(l));
    const r = await h.done;
    expect(lines).toEqual(['a', 'b', 'c']);
    expect(r.code).toBe(0);
  });

  it('인자에 공백·따옴표·줄바꿈·한글이 있어도 한 원소로 전달한다', async () => {
    const lines: string[] = [];
    const arg = '-x "따옴표" \n둘째 줄';
    const h = runProcess(node, ['-e', 'console.log(JSON.stringify(process.argv[1]))', arg], tmpdir(), (l) => lines.push(l));
    await h.done;
    expect(JSON.parse(lines[0])).toBe(arg);
  });

  it('stderr 끝부분과 종료 코드를 돌려준다', async () => {
    const h = runProcess(node, ['-e', "console.error('boom'); process.exit(3)"], tmpdir(), () => {});
    const r = await h.done;
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('boom');
  });

  it('없는 명령이면 spawnError를 돌려준다', async () => {
    const h = runProcess('definitely-not-a-command-xyz', [], tmpdir(), () => {});
    const r = await h.done;
    expect(r.spawnError).toBeTruthy();
  });

  it('kill하면 오래 걸리는 프로세스가 끝난다', async () => {
    const h = runProcess(node, ['-e', 'setTimeout(() => {}, 60000)'], tmpdir(), () => {});
    setTimeout(() => h.kill(), 200);
    const r = await h.done;
    expect(r.code).not.toBe(0);
  }, 10000);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/main/process.test.ts`
Expected: FAIL (`Cannot find module './process'`)

- [ ] **Step 3: 구현**

`src/main/process.ts`:

```ts
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface RunResult {
  code: number | null;
  stderr: string;
  spawnError?: string;
}

export interface RunHandle {
  kill(): void;
  done: Promise<RunResult>;
}

export function killTree(pid?: number): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // 이미 끝난 프로세스
    }
  }
}

export function runProcess(
  cmd: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
): RunHandle {
  const child = spawn(cmd, args, {
    cwd,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString('utf8')).slice(-4000);
  });
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (l) => onLine(l.replace(/\r$/, '')));

  const done = new Promise<RunResult>((resolve) => {
    child.on('error', (err) => resolve({ code: null, stderr, spawnError: err.message }));
    child.on('close', (code) => resolve({ code, stderr }));
  });
  return { kill: () => killTree(child.pid), done };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/main/process.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/process.ts src/main/process.test.ts
git commit -m "feat: CLI 실행과 줄 단위 출력, 프로세스 트리 종료"
```

---

### Task 5: 어댑터 인터페이스와 Claude 어댑터

**Files:**
- Create: `src/main/adapter.ts`, `src/main/claude.ts`
- Test: `src/main/claude.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`, `AgentId`, `Usage` (types), `detectLimit` (Task 3)
- Produces:
  - `type Outcome = { status: 'done' } | { status: 'cancelled' } | { status: 'failed'; message: string } | { status: 'limited'; message: string; resetHint?: string }`
  - `interface ParsedLine { events: AgentEvent[]; sessionId?: string; usageDelta?: Usage; outcome?: Outcome; finalText?: string }`
  - `interface Adapter { id: AgentId; command(): string; runArgs(prompt: string, cwd: string, budgetUsd: number): string[]; resumeArgs(sessionId: string, cwd: string, budgetUsd: number): string[]; opinionArgs(prompt: string, repo: string): string[]; parseLine(line: string): ParsedLine }`
  - `safePrompt(p: string): string`, `tryJson(line: string): Record<string, unknown> | null`, `RESUME_PROMPT = '이어서 진행해줘'`
  - `claudeAdapter: Adapter`

- [ ] **Step 1: adapter.ts 작성 (타입과 공용 함수)**

`src/main/adapter.ts`:

```ts
import type { AgentEvent, AgentId, Usage } from '../shared/types';

export type Outcome =
  | { status: 'done' }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }
  | { status: 'limited'; message: string; resetHint?: string };

export interface ParsedLine {
  events: AgentEvent[];
  sessionId?: string;
  usageDelta?: Usage;
  outcome?: Outcome;
  finalText?: string;
}

export interface Adapter {
  id: AgentId;
  command(): string;
  runArgs(prompt: string, cwd: string, budgetUsd: number): string[];
  resumeArgs(sessionId: string, cwd: string, budgetUsd: number): string[];
  opinionArgs(prompt: string, repo: string): string[];
  parseLine(line: string): ParsedLine;
}

export const RESUME_PROMPT = '이어서 진행해줘';

// '-'로 시작하는 지시문이 CLI 옵션으로 해석되지 않게 앞에 공백을 붙인다
export function safePrompt(p: string): string {
  return p.startsWith('-') ? ` ${p}` : p;
}

export function tryJson(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/main/claude.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeAdapter as a } from './claude';

describe('claudeAdapter args', () => {
  it('runArgs: 지시문을 -p 바로 뒤 한 원소로, 고정 옵션과 상한을 붙인다', () => {
    expect(a.runArgs('고쳐줘', 'C:/wt', 2)).toEqual([
      '-p', '고쳐줘',
      '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'acceptEdits',
      '--max-budget-usd', '2',
    ]);
  });

  it("'-'로 시작하는 지시문은 앞에 공백을 붙인다", () => {
    expect(a.runArgs('-rf 지워', 'C:/wt', 2)[1]).toBe(' -rf 지워');
  });

  it('resumeArgs: --resume 세션과 재개 문구', () => {
    expect(a.resumeArgs('sid-1', 'C:/wt', 3)).toEqual([
      '-p', '이어서 진행해줘', '--resume', 'sid-1',
      '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'acceptEdits',
      '--max-budget-usd', '3',
    ]);
  });

  it('opinionArgs: plan 모드, 상한 0.3', () => {
    const args = a.opinionArgs('누가?', 'C:/repo');
    expect(args).toContain('plan');
    expect(args.slice(-2)).toEqual(['--max-budget-usd', '0.3']);
  });
});

describe('claudeAdapter.parseLine', () => {
  it('init 줄에서 세션 ID', () => {
    expect(a.parseLine('{"type":"system","subtype":"init","session_id":"abc"}').sessionId).toBe('abc');
  });

  it('assistant 텍스트와 도구 사용을 이벤트로', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '읽어볼게요' },
          { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } },
        ],
      },
    });
    expect(a.parseLine(line).events).toEqual([
      { kind: 'text', text: '읽어볼게요' },
      { kind: 'tool', name: 'Read', detail: 'a.ts' },
    ]);
  });

  it('성공 result: done, 비용, 최종 텍스트', () => {
    const p = a.parseLine('{"type":"result","subtype":"success","is_error":false,"result":"끝","total_cost_usd":0.12,"session_id":"abc"}');
    expect(p.outcome).toEqual({ status: 'done' });
    expect(p.usageDelta).toEqual({ costUsd: 0.12 });
    expect(p.finalText).toBe('끝');
  });

  it('subtype에 budget이 들어가면 limited(사용량 상한 도달)', () => {
    const p = a.parseLine('{"type":"result","subtype":"error_max_budget_usd","is_error":true,"total_cost_usd":0.5}');
    expect(p.outcome).toEqual({ status: 'limited', message: '사용량 상한 도달' });
  });

  it('한도 문구 result는 limited, 나머지 오류는 failed', () => {
    const lim = a.parseLine('{"type":"result","subtype":"success","is_error":true,"result":"Claude AI usage limit reached|1759400000"}');
    expect(lim.outcome?.status).toBe('limited');
    const bad = a.parseLine('{"type":"result","subtype":"error_during_execution","is_error":true,"result":"crash"}');
    expect(bad.outcome).toEqual({ status: 'failed', message: 'crash' });
  });

  it('JSON이 아닌 줄은 raw 이벤트', () => {
    expect(a.parseLine('Warning: something').events).toEqual([{ kind: 'raw', line: 'Warning: something' }]);
  });

  it('실제 샘플(fixtures/claude-run.jsonl)에서 세션 ID와 done을 얻는다', () => {
    const f = join(__dirname, '../../fixtures/claude-run.jsonl');
    if (!existsSync(f)) return;
    const parsed = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => a.parseLine(l));
    expect(parsed.some((p) => p.sessionId)).toBe(true);
    expect(parsed.some((p) => p.outcome?.status === 'done')).toBe(true);
    expect(parsed.flatMap((p) => p.events).some((e) => e.kind === 'raw')).toBe(false);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/main/claude.test.ts`
Expected: FAIL (`Cannot find module './claude'`)

- [ ] **Step 4: 구현**

`src/main/claude.ts`:

```ts
import type { AgentEvent } from '../shared/types';
import { type Adapter, type Outcome, type ParsedLine, RESUME_PROMPT, safePrompt, tryJson } from './adapter';
import { detectLimit } from './limit';

function common(budgetUsd: number, mode: 'acceptEdits' | 'plan'): string[] {
  return [
    '--output-format', 'stream-json', '--verbose',
    '--permission-mode', mode,
    '--max-budget-usd', String(budgetUsd),
  ];
}

function summarize(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  const v = o.file_path ?? o.command ?? o.pattern ?? o.path ?? o.url;
  return typeof v === 'string' ? v : JSON.stringify(o).slice(0, 120);
}

export function parseClaudeLine(line: string): ParsedLine {
  const obj = tryJson(line);
  if (!obj) return { events: [{ kind: 'raw', line }] };

  if (obj.type === 'system') {
    return obj.subtype === 'init' && typeof obj.session_id === 'string'
      ? { events: [], sessionId: obj.session_id }
      : { events: [] };
  }

  if (obj.type === 'assistant') {
    const content = (obj.message as { content?: unknown[] } | undefined)?.content ?? [];
    const events: AgentEvent[] = [];
    for (const c of content as Record<string, unknown>[]) {
      if (c.type === 'text' && typeof c.text === 'string') events.push({ kind: 'text', text: c.text });
      if (c.type === 'tool_use') events.push({ kind: 'tool', name: String(c.name), detail: summarize(c.input) });
    }
    return { events };
  }

  if (obj.type === 'result') {
    const text = typeof obj.result === 'string' ? obj.result : '';
    const subtype = String(obj.subtype ?? '');
    let outcome: Outcome;
    if (subtype.includes('budget')) {
      outcome = { status: 'limited', message: '사용량 상한 도달' };
    } else if (!obj.is_error && subtype === 'success') {
      outcome = { status: 'done' };
    } else {
      const lim = detectLimit(text);
      outcome = lim.limited
        ? { status: 'limited', message: text, resetHint: lim.resetHint }
        : { status: 'failed', message: text || subtype };
    }
    const result: ParsedLine = { events: [], outcome, finalText: text };
    if (typeof obj.session_id === 'string') result.sessionId = obj.session_id;
    if (typeof obj.total_cost_usd === 'number') result.usageDelta = { costUsd: obj.total_cost_usd };
    return result;
  }

  return { events: [] };
}

export const claudeAdapter: Adapter = {
  id: 'claude',
  command: () => 'claude',
  runArgs: (prompt, _cwd, budgetUsd) => ['-p', safePrompt(prompt), ...common(budgetUsd, 'acceptEdits')],
  resumeArgs: (sessionId, _cwd, budgetUsd) => [
    '-p', RESUME_PROMPT, '--resume', sessionId, ...common(budgetUsd, 'acceptEdits'),
  ],
  opinionArgs: (prompt) => ['-p', safePrompt(prompt), ...common(0.3, 'plan')],
  parseLine: parseClaudeLine,
};
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/main/claude.test.ts`
Expected: PASS (11 tests). fixture 테스트가 실패하면 `docs/cli-notes.md`의 실제 필드에 맞춰 `parseClaudeLine`과 위 샘플 줄을 고친다.

- [ ] **Step 6: Commit**

```bash
git add src/main/adapter.ts src/main/claude.ts src/main/claude.test.ts
git commit -m "feat: 어댑터 인터페이스와 Claude 어댑터"
```

---

### Task 6: Codex 어댑터

**Files:**
- Create: `src/main/codex.ts`
- Test: `src/main/codex.test.ts`

**Interfaces:**
- Consumes: `Adapter`, `ParsedLine`, `RESUME_PROMPT`, `safePrompt`, `tryJson` (Task 5), `detectLimit` (Task 3)
- Produces: `codexAdapter: Adapter`, `findCodexExe(base?: string): string | null`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/main/codex.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexAdapter as a, findCodexExe } from './codex';

describe('codexAdapter args', () => {
  it('runArgs: workspace-write 샌드박스, -C worktree, 지시문 마지막', () => {
    expect(a.runArgs('고쳐줘', 'C:/wt', 2)).toEqual(['exec', '--json', '-s', 'workspace-write', '-C', 'C:/wt', '고쳐줘']);
  });

  it("'-'로 시작하는 지시문은 앞에 공백", () => {
    expect(a.runArgs('-x', 'C:/wt', 2).at(-1)).toBe(' -x');
  });

  it('resumeArgs: exec resume --json <세션> <재개 문구>', () => {
    expect(a.resumeArgs('t-1', 'C:/wt', 2)).toEqual(['exec', 'resume', '--json', 't-1', '이어서 진행해줘']);
  });

  it('opinionArgs: read-only, -C 원본 저장소', () => {
    expect(a.opinionArgs('누가?', 'C:/repo')).toEqual(['exec', '--json', '-s', 'read-only', '-C', 'C:/repo', '누가?']);
  });
});

describe('codexAdapter.parseLine', () => {
  it('thread.started에서 세션 ID', () => {
    expect(a.parseLine('{"type":"thread.started","thread_id":"t-1"}').sessionId).toBe('t-1');
  });

  it('agent_message는 text 이벤트이자 finalText', () => {
    const p = a.parseLine('{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"완료"}}');
    expect(p.events).toEqual([{ kind: 'text', text: '완료' }]);
    expect(p.finalText).toBe('완료');
  });

  it('명령 실행과 파일 변경은 tool 이벤트', () => {
    expect(a.parseLine('{"type":"item.completed","item":{"type":"command_execution","command":"npm test"}}').events)
      .toEqual([{ kind: 'tool', name: 'shell', detail: 'npm test' }]);
    expect(a.parseLine('{"type":"item.completed","item":{"type":"file_change","changes":[{"path":"a.ts"},{"path":"b.ts"}]}}').events)
      .toEqual([{ kind: 'tool', name: 'edit', detail: 'a.ts, b.ts' }]);
  });

  it('turn.completed는 done과 토큰 합', () => {
    const p = a.parseLine('{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20}}');
    expect(p.outcome).toEqual({ status: 'done' });
    expect(p.usageDelta).toEqual({ tokens: 120 });
  });

  it('turn.failed 한도 문구는 limited, 그 외는 failed', () => {
    expect(a.parseLine('{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit. Try again in 2 days."}}').outcome?.status)
      .toBe('limited');
    expect(a.parseLine('{"type":"turn.failed","error":{"message":"boom"}}').outcome)
      .toEqual({ status: 'failed', message: 'boom' });
  });

  it('error 이벤트는 오류 이벤트만 내고, 한도일 때만 outcome을 정한다', () => {
    const p = a.parseLine('{"type":"error","message":"Reconnecting... 1/5"}');
    expect(p.events).toEqual([{ kind: 'error', message: 'Reconnecting... 1/5' }]);
    expect(p.outcome).toBeUndefined();
  });

  it('JSON이 아닌 줄은 raw', () => {
    expect(a.parseLine('plain text').events).toEqual([{ kind: 'raw', line: 'plain text' }]);
  });

  it('실제 샘플(fixtures/codex-run.jsonl)에서 세션 ID를 얻는다', () => {
    const f = join(__dirname, '../../fixtures/codex-run.jsonl');
    if (!existsSync(f)) return;
    const parsed = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => a.parseLine(l));
    expect(parsed.some((p) => p.sessionId)).toBe(true);
  });
});

describe('findCodexExe', () => {
  it('bin/*/codex.exe 중 가장 최근 것을 고른다', () => {
    const base = mkdtempSync(join(tmpdir(), 'codexbin-'));
    for (const [dir, t] of [['old', 1000], ['new', 2000]] as const) {
      mkdirSync(join(base, dir));
      writeFileSync(join(base, dir, 'codex.exe'), '');
      utimesSync(join(base, dir, 'codex.exe'), t, t);
    }
    mkdirSync(join(base, 'empty'));
    expect(findCodexExe(base)).toBe(join(base, 'new', 'codex.exe'));
  });

  it('폴더가 없으면 null', () => {
    expect(findCodexExe(join(tmpdir(), 'no-such-dir-xyz'))).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/main/codex.test.ts`
Expected: FAIL (`Cannot find module './codex'`)

- [ ] **Step 3: 구현**

`src/main/codex.ts`:

```ts
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type Adapter, type ParsedLine, RESUME_PROMPT, safePrompt, tryJson } from './adapter';
import { detectLimit } from './limit';

export function findCodexExe(
  base = join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin'),
): string | null {
  if (!existsSync(base)) return null;
  const candidates = readdirSync(base)
    .map((d) => join(base, d, 'codex.exe'))
    .filter((p) => existsSync(p));
  if (candidates.length === 0) return null;
  return candidates.sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs)[0];
}

function failure(message: string): ParsedLine {
  const lim = detectLimit(message);
  return {
    events: [{ kind: 'error', message }],
    outcome: lim.limited ? { status: 'limited', message, resetHint: lim.resetHint } : { status: 'failed', message },
  };
}

export function parseCodexLine(line: string): ParsedLine {
  const obj = tryJson(line);
  if (!obj) return { events: [{ kind: 'raw', line }] };

  switch (obj.type) {
    case 'thread.started':
      return { events: [], sessionId: typeof obj.thread_id === 'string' ? obj.thread_id : undefined };
    case 'item.completed': {
      const it = (obj.item ?? {}) as Record<string, unknown>;
      if (it.type === 'agent_message' && typeof it.text === 'string') {
        return { events: [{ kind: 'text', text: it.text }], finalText: it.text };
      }
      if (it.type === 'command_execution') {
        return { events: [{ kind: 'tool', name: 'shell', detail: String(it.command ?? '') }] };
      }
      if (it.type === 'file_change') {
        const paths = ((it.changes as { path?: string }[] | undefined) ?? []).map((c) => c.path).join(', ');
        return { events: [{ kind: 'tool', name: 'edit', detail: paths }] };
      }
      return { events: [] };
    }
    case 'turn.completed': {
      const u = (obj.usage ?? {}) as Record<string, number>;
      return {
        events: [],
        outcome: { status: 'done' },
        usageDelta: { tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) },
      };
    }
    case 'turn.failed':
      return failure(String((obj.error as { message?: string } | undefined)?.message ?? 'turn failed'));
    case 'error': {
      // 재연결 같은 일시 오류도 이 타입으로 오므로 한도일 때만 결과를 정한다
      const message = String(obj.message ?? 'error');
      return detectLimit(message).limited ? failure(message) : { events: [{ kind: 'error', message }] };
    }
    default:
      return { events: [] };
  }
}

export const codexAdapter: Adapter = {
  id: 'codex',
  command: () => findCodexExe() ?? 'codex',
  runArgs: (prompt, cwd) => ['exec', '--json', '-s', 'workspace-write', '-C', cwd, safePrompt(prompt)],
  resumeArgs: (sessionId) => ['exec', 'resume', '--json', sessionId, RESUME_PROMPT],
  opinionArgs: (prompt, repo) => ['exec', '--json', '-s', 'read-only', '-C', repo, safePrompt(prompt)],
  parseLine: parseCodexLine,
};
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/main/codex.test.ts`
Expected: PASS (14 tests). fixture 테스트가 실패하면 `docs/cli-notes.md`에 맞춰 파서와 샘플을 고친다.

- [ ] **Step 5: Commit**

```bash
git add src/main/codex.ts src/main/codex.test.ts
git commit -m "feat: Codex 어댑터와 실행 파일 찾기"
```

---

### Task 7: git worktree 다루기

**Files:**
- Create: `src/main/worktree.ts`
- Test: `src/main/worktree.test.ts`

**Interfaces:**
- Produces:
  - `repoRoot(dir: string): Promise<string | null>`
  - `isDirty(repo: string): Promise<boolean>`
  - `worktreePath(repo: string, id: string): string`
  - `createWorktree(repo: string, id: string): Promise<{ path: string; branch: string }>`
  - `changes(worktree: string): Promise<{ files: string[]; stat: string }>`
  - `removeWorktree(repo: string, id: string): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/main/worktree.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { changes, createWorktree, isDirty, removeWorktree, repoRoot, worktreePath } from './worktree';

let repo: string;

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'agent desk-')); // 공백 포함 경로
  repo = join(base, 'my repo');
  mkdirSync(repo);
  git(repo, 'init');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', '.');
  git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init');
});

describe('worktree', () => {
  it('repoRoot: 하위 폴더에서도 저장소 최상위를, git 아니면 null', async () => {
    mkdirSync(join(repo, 'sub'));
    expect(resolve((await repoRoot(join(repo, 'sub')))!)).toBe(resolve(repo));
    expect(await repoRoot(tmpdir())).toBeNull();
  });

  it('isDirty: 커밋 안 된 변경 감지', async () => {
    expect(await isDirty(repo)).toBe(false);
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    expect(await isDirty(repo)).toBe(true);
  });

  it('create → changes → remove', async () => {
    const wt = await createWorktree(repo, 'abc123');
    expect(wt.path).toBe(worktreePath(repo, 'abc123'));
    expect(wt.path.startsWith(join(repo, ''))).toBe(false); // 원본 폴더 밖
    expect(wt.branch).toBe('tm/abc123');
    expect(existsSync(join(wt.path, 'a.txt'))).toBe(true);

    writeFileSync(join(wt.path, 'a.txt'), 'edited\n');
    writeFileSync(join(wt.path, 'new.txt'), 'new\n');
    const c = await changes(wt.path);
    expect(c.files.sort()).toEqual(['a.txt', 'new.txt']);
    expect(c.stat).toMatch(/1 file changed/);

    await removeWorktree(repo, 'abc123');
    expect(existsSync(wt.path)).toBe(false);
    expect(git(repo, 'branch', '--list', 'tm/abc123').trim()).toBe('');
  });
});
```

`tmpdir()`가 git 저장소 안에 있지 않다는 전제다(Windows 기본 `%TEMP%`).

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/main/worktree.test.ts`
Expected: FAIL (`Cannot find module './worktree'`)

- [ ] **Step 3: 구현**

`src/main/worktree.ts`:

```ts
import { execFile } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], { windowsHide: true });
  return stdout;
}

export async function repoRoot(dir: string): Promise<string | null> {
  try {
    return resolve((await git(dir, ['rev-parse', '--show-toplevel'])).trim());
  } catch {
    return null;
  }
}

export async function isDirty(repo: string): Promise<boolean> {
  return (await git(repo, ['status', '--porcelain'])).trim().length > 0;
}

export function worktreePath(repo: string, id: string): string {
  return join(dirname(repo), '.tm-worktrees', basename(repo), id);
}

export async function createWorktree(repo: string, id: string): Promise<{ path: string; branch: string }> {
  const path = worktreePath(repo, id);
  const branch = `tm/${id}`;
  await git(repo, ['worktree', 'add', '-b', branch, path, 'HEAD']);
  return { path, branch };
}

export async function changes(worktree: string): Promise<{ files: string[]; stat: string }> {
  const porcelain = await git(worktree, ['status', '--porcelain', '--untracked-files=all']);
  const files = porcelain.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''));
  const stat = (await git(worktree, ['diff', '--stat', 'HEAD'])).trim().split('\n').pop() ?? '';
  return { files, stat };
}

export async function removeWorktree(repo: string, id: string): Promise<void> {
  await git(repo, ['worktree', 'remove', '--force', worktreePath(repo, id)]);
  await git(repo, ['branch', '-D', `tm/${id}`]);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/main/worktree.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/worktree.ts src/main/worktree.test.ts
git commit -m "feat: 작업별 git worktree 생성·조회·정리"
```

---

### Task 8: 작업 저장소 (tasks.json)

**Files:**
- Create: `src/main/taskStore.ts`
- Test: `src/main/taskStore.test.ts`

**Interfaces:**
- Consumes: `Task`, `AgentId` (types)
- Produces: `class TaskStore { constructor(file: string); list(): Task[]; get(id: string): Task | undefined; save(task: Task): void; markInterrupted(now?: string): void; recentlyLimited(agent: AgentId, now?: number, windowMs?: number): boolean }`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/main/taskStore.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Task } from '../shared/types';
import { TaskStore } from './taskStore';

function task(over: Partial<Task>): Task {
  return { id: 't1', repo: 'C:/r', prompt: 'p', agent: 'claude', budgetUsd: 2, status: 'running', usage: {}, createdAt: '2026-10-02T00:00:00Z', ...over };
}

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'store-')), 'tasks.json');

describe('TaskStore', () => {
  it('저장 후 새 인스턴스로 다시 읽는다, 최신이 먼저', () => {
    const f = tmpFile();
    const s = new TaskStore(f);
    s.save(task({ id: 'a', createdAt: '2026-10-01T00:00:00Z' }));
    s.save(task({ id: 'b', createdAt: '2026-10-02T00:00:00Z' }));
    expect(new TaskStore(f).list().map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('markInterrupted: running·consulting만 interrupted로', () => {
    const f = tmpFile();
    const s = new TaskStore(f);
    s.save(task({ id: 'r', status: 'running' }));
    s.save(task({ id: 'c', status: 'consulting' }));
    s.save(task({ id: 'd', status: 'done' }));
    s.markInterrupted('2026-10-02T01:00:00Z');
    expect(s.get('r')).toMatchObject({ status: 'interrupted', endedAt: '2026-10-02T01:00:00Z' });
    expect(s.get('c')!.status).toBe('interrupted');
    expect(s.get('d')!.status).toBe('done');
    expect(new TaskStore(f).get('r')!.status).toBe('interrupted'); // 파일에도 반영
  });

  it('recentlyLimited: 해당 AI가 창 안에서 limited로 끝난 작업이 있으면 true', () => {
    const s = new TaskStore(tmpFile());
    const now = Date.parse('2026-10-02T10:00:00Z');
    s.save(task({ id: 'x', agent: 'codex', status: 'limited', endedAt: '2026-10-02T08:00:00Z' }));
    expect(s.recentlyLimited('codex', now)).toBe(true);
    expect(s.recentlyLimited('claude', now)).toBe(false);
    expect(s.recentlyLimited('codex', now, 60 * 60 * 1000)).toBe(false);
  });

  it('깨진 tasks.json은 .bak으로 옮기고 빈 상태로 시작한다', () => {
    const f = tmpFile();
    writeFileSync(f, '{not json');
    const s = new TaskStore(f);
    expect(s.list()).toEqual([]);
    expect(existsSync(`${f}.bak`)).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/main/taskStore.test.ts`
Expected: FAIL (`Cannot find module './taskStore'`)

- [ ] **Step 3: 구현**

`src/main/taskStore.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentId, Task } from '../shared/types';

const FIVE_HOURS = 5 * 60 * 60 * 1000;

export class TaskStore {
  private tasks = new Map<string, Task>();

  constructor(private file: string) {
    if (!existsSync(file)) return;
    try {
      for (const t of JSON.parse(readFileSync(file, 'utf8')) as Task[]) this.tasks.set(t.id, t);
    } catch {
      renameSync(file, `${file}.bak`); // 기록을 덮어쓰지 않도록 보존
    }
  }

  list(): Task[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  save(task: Task): void {
    this.tasks.set(task.id, task);
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.list(), null, 2));
    renameSync(tmp, this.file);
  }

  markInterrupted(now = new Date().toISOString()): void {
    let changed: Task | undefined;
    for (const t of this.tasks.values()) {
      if (t.status === 'running' || t.status === 'consulting') {
        t.status = 'interrupted';
        t.endedAt = now;
        changed = t;
      }
    }
    if (changed) this.save(changed);
  }

  // ponytail: 초기화 시각 문구는 형식이 제각각이라 "최근 5시간 안에 한도로 끝난 작업"으로 근사한다
  recentlyLimited(agent: AgentId, now = Date.now(), windowMs = FIVE_HOURS): boolean {
    return this.list().some(
      (t) => t.agent === agent && t.status === 'limited' && t.endedAt !== undefined && now - Date.parse(t.endedAt) < windowMs,
    );
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/main/taskStore.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/taskStore.ts src/main/taskStore.test.ts
git commit -m "feat: tasks.json 작업 저장소"
```

---

### Task 9: 작업 실행기 (실행·재개·중지·정리)

**Files:**
- Create: `src/main/runner.ts`
- Test: `src/main/runner.test.ts`

**Interfaces:**
- Consumes: `Adapter`, `Outcome` (Task 5), `runProcess` (Task 4), `addUsage`, `detectLimit` (Task 3), `createWorktree`, `changes`, `removeWorktree` (Task 7), `TaskStore` (Task 8)
- Produces:
  - `interface Emitter { update(task: Task): void; event(id: string, e: AgentEvent): void }`
  - `promptFor(task: Task): string`
  - `resolveOutcome(outcome: Outcome | undefined, code: number | null, stderr: string): Outcome`
  - `class TaskRunner { constructor(store: TaskStore, adapters: Record<AgentId, Adapter>, emit: Emitter, logDir: string); isRunning(id: string): boolean; start(id: string): Promise<void>; resume(id: string, budgetUsd?: number): Promise<void>; cancel(id: string): void; cleanup(id: string): Promise<void>; readEvents(id: string): AgentEvent[] }`

- [ ] **Step 1: 실패하는 테스트 작성**

가짜 어댑터는 `node -e <스크립트>`를 실행하고, `{"t":"text","v":...}` / `{"t":"sid","v":...}` / `{"t":"done"}` 줄을 해석한다.

`src/main/runner.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, Task } from '../shared/types';
import type { Adapter, ParsedLine } from './adapter';
import { TaskRunner, promptFor, resolveOutcome } from './runner';
import { TaskStore } from './taskStore';

function fakeAdapter(script: string): Adapter {
  const parse = (line: string): ParsedLine => {
    const o = JSON.parse(line);
    if (o.t === 'text') return { events: [{ kind: 'text', text: o.v }] };
    if (o.t === 'sid') return { events: [], sessionId: o.v, usageDelta: { tokens: 10 } };
    if (o.t === 'done') return { events: [], outcome: { status: 'done' } };
    return { events: [] };
  };
  return {
    id: 'claude',
    command: () => process.execPath,
    runArgs: () => ['-e', script],
    resumeArgs: () => ['-e', script],
    opinionArgs: () => [],
    parseLine: parse,
  };
}

let repo: string;
let store: TaskStore;
let events: AgentEvent[];
let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'runner-'));
  repo = join(base, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['-C', repo, 'init']);
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init']);
  store = new TaskStore(join(base, 'data', 'tasks.json'));
  events = [];
});

function newTask(id: string): Task {
  const t: Task = { id, repo, prompt: 'p', agent: 'claude', budgetUsd: 2, status: 'running', usage: {}, createdAt: new Date().toISOString() };
  store.save(t);
  return t;
}

function runner(script: string) {
  return new TaskRunner(
    store,
    { claude: fakeAdapter(script), codex: fakeAdapter(script) },
    { update: () => {}, event: (_id, e) => events.push(e) },
    join(base, 'data', 'logs'),
  );
}

const OK_SCRIPT = `
const fs = require('fs');
console.log(JSON.stringify({t:'sid', v:'s-1'}));
console.log(JSON.stringify({t:'text', v:'hello'}));
fs.writeFileSync('made.txt', 'x');
console.log(JSON.stringify({t:'done'}));`;

describe('TaskRunner', () => {
  it('start: worktree에서 실행하고 이벤트·세션·사용량·변경 파일·done을 기록', async () => {
    newTask('ok1');
    const r = runner(OK_SCRIPT);
    await r.start('ok1');
    const t = store.get('ok1')!;
    expect(t.status).toBe('done');
    expect(t.sessionId).toBe('s-1');
    expect(t.usage.tokens).toBe(10);
    expect(t.changedFiles).toEqual(['made.txt']);
    expect(existsSync(join(t.worktree!, 'made.txt'))).toBe(true);
    expect(existsSync(join(repo, 'made.txt'))).toBe(false); // 원본은 그대로
    expect(events).toContainEqual({ kind: 'text', text: 'hello' });
    expect(r.readEvents('ok1')).toContainEqual({ kind: 'text', text: 'hello' });
  });

  it('cancel: cancelled로 끝난다', async () => {
    newTask('c1');
    const r = runner('setTimeout(() => {}, 60000)');
    const p = r.start('c1');
    await new Promise((res) => setTimeout(res, 1500));
    r.cancel('c1');
    await p;
    expect(store.get('c1')!.status).toBe('cancelled');
  }, 15000);

  it('stderr의 한도 문구 + 비정상 종료는 limited', async () => {
    newTask('l1');
    await runner("console.error('usage limit reached'); process.exit(1)").start('l1');
    expect(store.get('l1')!.status).toBe('limited');
  });

  it('CLI가 없으면 failed와 안내 문구', async () => {
    newTask('n1');
    const r = new TaskRunner(
      store,
      { claude: { ...fakeAdapter(''), command: () => 'no-such-cli-xyz' }, codex: fakeAdapter('') },
      { update: () => {}, event: () => {} },
      join(base, 'data', 'logs'),
    );
    await r.start('n1');
    expect(store.get('n1')!.status).toBe('failed');
    expect(store.get('n1')!.error).toContain('CLI를 찾을 수 없습니다');
  });

  it('resume: 세션 ID가 없으면 거부, 있으면 같은 worktree에서 다시 실행', async () => {
    newTask('r1');
    const r = runner(OK_SCRIPT);
    store.get('r1')!.status = 'limited';
    await expect(r.resume('r1')).rejects.toThrow('이어서 할 수 없는');
    await r.start('r1');
    const wt = store.get('r1')!.worktree;
    store.get('r1')!.status = 'limited';
    await r.resume('r1', 5);
    expect(store.get('r1')).toMatchObject({ status: 'done', worktree: wt, budgetUsd: 5 });
    expect(store.get('r1')!.usage.tokens).toBe(20);
  });

  it('cleanup: 실행 중이면 거부, 끝났으면 worktree와 브랜치 삭제', async () => {
    newTask('k1');
    const r = runner('setTimeout(() => {}, 60000)');
    const p = r.start('k1');
    await new Promise((res) => setTimeout(res, 1500));
    await expect(r.cleanup('k1')).rejects.toThrow('실행 중');
    r.cancel('k1');
    await p;
    const wt = store.get('k1')!.worktree!;
    await r.cleanup('k1');
    expect(existsSync(wt)).toBe(false);
    expect(store.get('k1')!.worktree).toBeUndefined();
  }, 15000);
});

describe('resolveOutcome', () => {
  it('done인데 종료 코드가 0이 아니면 failed', () => {
    expect(resolveOutcome({ status: 'done' }, 2, 'oops')).toEqual({ status: 'failed', message: 'oops' });
  });
  it('결과가 없고 코드 0이면 done', () => {
    expect(resolveOutcome(undefined, 0, '')).toEqual({ status: 'done' });
  });
  it('로그인 문제로 실패하면 터미널 로그인 안내를 붙인다', () => {
    const o = resolveOutcome(undefined, 1, 'Error: not logged in');
    expect(o.status).toBe('failed');
    expect('message' in o && o.message).toContain('터미널에서 claude 또는 codex에 로그인하세요');
  });
});

describe('promptFor', () => {
  it('합의된 계획이 있으면 지시문 뒤에 붙인다', () => {
    const t = { prompt: '고쳐줘', consult: { opinions: {}, decision: { assignee: 'codex', reason: 'r', plan: '1. 테스트' } } } as unknown as Task;
    expect(promptFor(t)).toBe('고쳐줘\n\n합의된 계획:\n1. 테스트');
  });
  it('계획이 비어 있으면 지시문만', () => {
    const t = { prompt: '고쳐줘', consult: { opinions: {}, decision: { assignee: 'codex', reason: 'r', plan: '' } } } as unknown as Task;
    expect(promptFor(t)).toBe('고쳐줘');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/main/runner.test.ts`
Expected: FAIL (`Cannot find module './runner'`)

- [ ] **Step 3: 구현**

`src/main/runner.ts`:

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentEvent, AgentId, Task } from '../shared/types';
import type { Adapter, Outcome } from './adapter';
import { detectLimit } from './limit';
import { runProcess } from './process';
import type { TaskStore } from './taskStore';
import { addUsage } from './usage';
import { changes, createWorktree, removeWorktree } from './worktree';

export interface Emitter {
  update(task: Task): void;
  event(id: string, e: AgentEvent): void;
}

export function promptFor(task: Task): string {
  const plan = task.consult?.decision?.plan?.trim();
  return plan ? `${task.prompt}\n\n합의된 계획:\n${plan}` : task.prompt;
}

const AUTH_RE = /not logged in|log ?in|unauthorized|authenticat|\b401\b/i;

export function resolveOutcome(outcome: Outcome | undefined, code: number | null, stderr: string): Outcome {
  if (outcome && outcome.status !== 'done') return withLoginHint(outcome);
  const lim = detectLimit(stderr);
  if (code !== 0 && lim.limited) return { status: 'limited', message: stderr.trim().slice(-500), resetHint: lim.resetHint };
  if (code === 0) return outcome ?? { status: 'done' };
  return withLoginHint({ status: 'failed', message: stderr.trim().slice(-500) || `종료 코드 ${code}` });
}

// 설계 4절: 로그인 문제로 실패하면 터미널 로그인 안내를 앞에 붙인다
function withLoginHint(o: Outcome): Outcome {
  if (o.status !== 'failed' || !AUTH_RE.test(o.message)) return o;
  return { status: 'failed', message: `로그인이 필요합니다. 터미널에서 claude 또는 codex에 로그인하세요.\n${o.message}` };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class TaskRunner {
  private running = new Map<string, { kill(): void; cancelled: boolean }>();

  constructor(
    private store: TaskStore,
    private adapters: Record<AgentId, Adapter>,
    private emit: Emitter,
    private logDir: string,
  ) {}

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  private mustGet(id: string): Task {
    const t = this.store.get(id);
    if (!t) throw new Error(`작업을 찾을 수 없습니다: ${id}`);
    return t;
  }

  private publish(task: Task): void {
    this.store.save(task);
    this.emit.update(task);
  }

  async start(id: string): Promise<void> {
    const task = this.mustGet(id);
    const adapter = this.adapters[task.agent!];
    try {
      const wt = await createWorktree(task.repo, task.id);
      task.worktree = wt.path;
      task.branch = wt.branch;
    } catch (e) {
      return this.finish(task, { status: 'failed', message: `worktree 생성 실패: ${errMsg(e)}` });
    }
    task.status = 'running';
    this.publish(task);
    await this.exec(task, adapter.runArgs(promptFor(task), task.worktree, task.budgetUsd));
  }

  async resume(id: string, budgetUsd?: number): Promise<void> {
    const task = this.mustGet(id);
    if (!task.sessionId || !task.worktree || this.isRunning(id)) {
      throw new Error('이어서 할 수 없는 작업입니다 (세션 정보가 없거나 실행 중)');
    }
    if (budgetUsd !== undefined) task.budgetUsd = budgetUsd;
    task.status = 'running';
    task.error = undefined;
    task.resetHint = undefined;
    task.endedAt = undefined;
    this.publish(task);
    const adapter = this.adapters[task.agent!];
    await this.exec(task, adapter.resumeArgs(task.sessionId, task.worktree, task.budgetUsd));
  }

  cancel(id: string): void {
    const r = this.running.get(id);
    if (!r) return;
    r.cancelled = true;
    r.kill();
  }

  async cleanup(id: string): Promise<void> {
    const task = this.mustGet(id);
    if (this.isRunning(id) || task.status === 'running' || task.status === 'consulting') {
      throw new Error('실행 중인 작업은 정리할 수 없습니다');
    }
    if (task.worktree) await removeWorktree(task.repo, task.id);
    task.worktree = undefined;
    task.branch = undefined;
    this.publish(task);
  }

  readEvents(id: string): AgentEvent[] {
    const task = this.mustGet(id);
    const file = join(this.logDir, `${id}.jsonl`);
    if (!existsSync(file) || !task.agent) return [];
    const adapter = this.adapters[task.agent];
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => adapter.parseLine(l).events);
  }

  private async exec(task: Task, args: string[]): Promise<void> {
    const adapter = this.adapters[task.agent!];
    mkdirSync(this.logDir, { recursive: true });
    const logFile = join(this.logDir, `${task.id}.jsonl`);
    let outcome: Outcome | undefined;

    const handle = runProcess(adapter.command(), args, task.worktree!, (line) => {
      appendFileSync(logFile, `${line}\n`);
      const p = adapter.parseLine(line);
      if (p.sessionId) task.sessionId = p.sessionId;
      addUsage(task.usage, p.usageDelta);
      if (p.outcome) outcome = p.outcome;
      for (const e of p.events) this.emit.event(task.id, e);
      if (p.sessionId || p.usageDelta) this.publish(task);
    });
    const entry = { kill: handle.kill, cancelled: false };
    this.running.set(task.id, entry);
    const res = await handle.done;
    this.running.delete(task.id);

    const final: Outcome = entry.cancelled
      ? { status: 'cancelled' }
      : res.spawnError
        ? { status: 'failed', message: `CLI를 찾을 수 없습니다 (${adapter.id}): ${res.spawnError}` }
        : resolveOutcome(outcome, res.code, res.stderr);
    try {
      const c = await changes(task.worktree!);
      task.changedFiles = c.files;
      task.diffStat = c.stat;
    } catch {
      // worktree가 사라졌으면 변경 정보 없이 끝낸다
    }
    this.finish(task, final);
  }

  private finish(task: Task, o: Outcome): void {
    task.status = o.status;
    task.error = 'message' in o ? o.message : undefined;
    task.resetHint = o.status === 'limited' ? o.resetHint : undefined;
    task.endedAt = new Date().toISOString();
    this.publish(task);
  }
}
```

**`budgetGuard` 대체 구현 — Task 2에서 "구독 로그인에서 --max-budget-usd가 안 멈춤"으로 기록된 경우에만 적용한다.** `exec`의 줄 콜백에서 `addUsage(...)` 바로 다음 줄에 넣는다:

```ts
if (task.agent === 'claude' && !outcome && (task.usage.costUsd ?? 0) >= task.budgetUsd) {
  outcome = { status: 'limited', message: '사용량 상한 도달' };
  handle.kill();
}
```

그리고 `runner.test.ts`에 아래 테스트를 추가한다:

```ts
it('budgetGuard: 누적 비용이 상한 이상이면 limited', async () => {
  newTask('b1');
  const adapter: Adapter = {
    ...fakeAdapter("console.log(JSON.stringify({t:'cost'})); setTimeout(() => {}, 60000)"),
    parseLine: (l) => (JSON.parse(l).t === 'cost' ? { events: [], usageDelta: { costUsd: 3 } } : { events: [] }),
  };
  const r = new TaskRunner(store, { claude: adapter, codex: adapter }, { update: () => {}, event: () => {} }, join(base, 'data', 'logs'));
  await r.start('b1');
  expect(store.get('b1')).toMatchObject({ status: 'limited', error: '사용량 상한 도달' });
}, 15000);
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/main/runner.test.ts`
Expected: PASS (11 tests, budgetGuard 적용 시 12)

- [ ] **Step 5: Commit**

```bash
git add src/main/runner.ts src/main/runner.test.ts
git commit -m "feat: 작업 실행·재개·중지·정리"
```

---

### Task 10: 상의 모드

**Files:**
- Create: `src/main/consultant.ts`
- Test: `src/main/consultant.test.ts`

**Interfaces:**
- Consumes: `Adapter` (Task 5), `runProcess` (Task 4), `addUsage` (Task 3), `TaskStore` (Task 8), `Emitter` (Task 9)
- Produces:
  - `opinionPrompt(self: AgentId, request: string): string`
  - `decidePrompt(request: string, opinions: Record<AgentId, Opinion>): string` (본문에 "최종"이라는 단어를 포함한다 — 테스트가 이것으로 결정자 호출을 구분한다)
  - `extractJson(text: string): unknown`
  - `parseOpinion(text: string): Opinion | null`, `parseDecision(text: string): Decision | null`
  - `decideByRule(ops: Partial<Record<AgentId, OpinionResult>>): Decision | 'need-decider' | 'manual'`
  - `type RunOnce = (adapter: Adapter, args: string[], cwd: string) => Promise<{ finalText: string; usage: Usage; error?: string }>`, `runOnce: RunOnce`
  - `class Consultant { constructor(store: TaskStore, adapters: Record<AgentId, Adapter>, emit: Emitter, run?: RunOnce); consult(id: string): Promise<void> }`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/main/consultant.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Task } from '../shared/types';
import type { Adapter } from './adapter';
import { Consultant, type RunOnce, decideByRule, parseDecision, parseOpinion } from './consultant';
import { TaskStore } from './taskStore';

const op = (fit: string, approach = 'a') => JSON.stringify({ approach, difficulty: 2, fit, reason: 'r' });

describe('parseOpinion', () => {
  it('순수 JSON', () => {
    expect(parseOpinion(op('me'))).toEqual({ approach: 'a', difficulty: 2, fit: 'me', reason: 'r' });
  });
  it('코드펜스와 설명 문장이 섞여도 읽는다', () => {
    expect(parseOpinion(`판단 결과입니다.\n\`\`\`json\n${op('other')}\n\`\`\`\n참고하세요.`)?.fit).toBe('other');
  });
  it('난이도는 1~5로 자르고, 숫자가 아니면 3', () => {
    expect(parseOpinion(JSON.stringify({ approach: 'a', difficulty: 9, fit: 'me', reason: 'r' }))?.difficulty).toBe(5);
    expect(parseOpinion(JSON.stringify({ approach: 'a', difficulty: 'hard', fit: 'me', reason: 'r' }))?.difficulty).toBe(3);
  });
  it('필드가 틀리면 null', () => {
    expect(parseOpinion('{"approach":"a","fit":"maybe","reason":"r"}')).toBeNull();
    expect(parseOpinion('그냥 문장')).toBeNull();
  });
});

describe('parseDecision', () => {
  it('assignee는 claude/codex만', () => {
    expect(parseDecision('{"assignee":"codex","reason":"r","plan":"p"}')).toEqual({ assignee: 'codex', reason: 'r', plan: 'p' });
    expect(parseDecision('{"assignee":"gemini","reason":"r","plan":"p"}')).toBeNull();
  });
});

describe('decideByRule', () => {
  const o = (fit: 'me' | 'other' | 'either') => ({ approach: `by-${fit}`, difficulty: 2, fit, reason: 'r' });
  it('둘이 같은 AI를 가리키면 결정', () => {
    expect(decideByRule({ claude: o('other'), codex: o('me') })).toMatchObject({ assignee: 'codex', plan: 'by-me' });
  });
  it('갈리면 need-decider', () => {
    expect(decideByRule({ claude: o('me'), codex: o('me') })).toBe('need-decider');
    expect(decideByRule({ claude: o('either'), codex: o('either') })).toBe('need-decider');
  });
  it('한쪽만 있으면 그 의견대로, either면 그 AI 자신', () => {
    expect(decideByRule({ claude: o('other'), codex: { error: 'x' } })).toMatchObject({ assignee: 'codex' });
    expect(decideByRule({ codex: o('either') })).toMatchObject({ assignee: 'codex' });
  });
  it('둘 다 실패면 manual', () => {
    expect(decideByRule({ claude: { error: 'x' }, codex: { error: 'y' } })).toBe('manual');
  });
});

describe('Consultant.consult', () => {
  const dummy = (id: 'claude' | 'codex'): Adapter => ({
    id,
    command: () => id,
    runArgs: () => [],
    resumeArgs: () => [],
    opinionArgs: (p) => [id, p],
    parseLine: () => ({ events: [] }),
  });

  function setup(run: RunOnce) {
    const store = new TaskStore(join(mkdtempSync(join(tmpdir(), 'cons-')), 'tasks.json'));
    const t: Task = { id: 'q', repo: 'C:/r', prompt: '번역해줘', agent: null, budgetUsd: 2, status: 'consulting', usage: {}, createdAt: '2026-10-02T00:00:00Z' };
    store.save(t);
    const c = new Consultant(store, { claude: dummy('claude'), codex: dummy('codex') }, { update: () => {}, event: () => {} }, run);
    return { store, c };
  }

  it('의견이 일치하면 결정자 호출 없이 결정, 사용량 합산', async () => {
    const run = vi.fn<RunOnce>(async (a) => ({
      finalText: a.id === 'claude' ? op('other', 'claude-plan') : op('me', 'codex-plan'),
      usage: a.id === 'claude' ? { costUsd: 0.05 } : { tokens: 300 },
    }));
    const { store, c } = setup(run);
    await c.consult('q');
    expect(run).toHaveBeenCalledTimes(2);
    expect(store.get('q')!.consult!.decision).toMatchObject({ assignee: 'codex', plan: 'codex-plan' });
    expect(store.get('q')!.usage).toEqual({ costUsd: 0.05, tokens: 300 });
    expect(store.get('q')!.status).toBe('consulting');
  });

  it('갈리면 Claude 결정자를 한 번 더 부른다', async () => {
    const run = vi.fn<RunOnce>(async (_a, args) => ({
      finalText: String(args[1]).includes('최종') ? '{"assignee":"claude","reason":"r","plan":"p"}' : op('me'),
      usage: {},
    }));
    const { store, c } = setup(run);
    await c.consult('q');
    expect(run).toHaveBeenCalledTimes(3);
    expect(store.get('q')!.consult!.decision).toEqual({ assignee: 'claude', reason: 'r', plan: 'p' });
  });

  it('한쪽이 최근 한도면 상의 없이 다른 쪽', async () => {
    const run = vi.fn<RunOnce>();
    const { store, c } = setup(run);
    store.save({ id: 'old', repo: 'C:/r', prompt: 'x', agent: 'codex', budgetUsd: 2, status: 'limited', usage: {}, createdAt: '2026-10-01T00:00:00Z', endedAt: new Date().toISOString() });
    await c.consult('q');
    expect(run).not.toHaveBeenCalled();
    expect(store.get('q')!.consult!.decision!.assignee).toBe('claude');
  });

  it('둘 다 실패하면 결정 없이 의견 오류만 남긴다', async () => {
    const { store, c } = setup(async () => ({ finalText: '', usage: {}, error: 'limit' }));
    await c.consult('q');
    expect(store.get('q')!.consult!.decision).toBeUndefined();
    expect(store.get('q')!.consult!.opinions.codex).toEqual({ error: 'limit' });
  });

  it('상의 중 취소되면 결과를 덮어쓰지 않는다', async () => {
    const { store, c } = setup(async () => {
      store.get('q')!.status = 'cancelled';
      return { finalText: op('me'), usage: {} };
    });
    await c.consult('q');
    expect(store.get('q')!.status).toBe('cancelled');
    expect(store.get('q')!.consult!.decision).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/main/consultant.test.ts`
Expected: FAIL (`Cannot find module './consultant'`)

- [ ] **Step 3: 구현**

`src/main/consultant.ts`:

```ts
import type { AgentId, Decision, Opinion, OpinionResult, Task, Usage } from '../shared/types';
import type { Adapter } from './adapter';
import { runProcess } from './process';
import type { Emitter } from './runner';
import type { TaskStore } from './taskStore';
import { addUsage } from './usage';

const AGENTS: AgentId[] = ['claude', 'codex'];
const NAME: Record<AgentId, string> = { claude: 'Claude Code(Anthropic)', codex: 'Codex(OpenAI)' };
const other = (a: AgentId): AgentId => (a === 'claude' ? 'codex' : 'claude');

export function opinionPrompt(self: AgentId, request: string): string {
  return [
    `너는 ${NAME[self]}다. 아래 작업 요청을 너와 ${NAME[other(self)]} 중 누가 맡는 게 좋은지 판단해라.`,
    '파일을 수정하지 말고, 필요하면 저장소를 읽기만 해라.',
    '답은 다른 말 없이 JSON 한 개만 출력한다:',
    '{"approach": "내가 맡는다면 어떻게 할지 3줄 이내", "difficulty": 1~5 정수, "fit": "me" | "other" | "either", "reason": "판단 이유 1~2문장"}',
    'fit: me = 내가 맡는 게 낫다, other = 상대가 낫다, either = 누가 해도 비슷하다',
    '',
    '작업 요청:',
    request,
  ].join('\n');
}

export function decidePrompt(request: string, opinions: Record<AgentId, Opinion>): string {
  return [
    '두 AI의 의견을 보고 이 작업의 최종 담당과 실행 계획을 정해라. 파일은 수정하지 마라.',
    '답은 다른 말 없이 JSON 한 개만 출력한다:',
    '{"assignee": "claude" | "codex", "reason": "이유 1~2문장", "plan": "담당 AI가 따를 실행 계획 5줄 이내"}',
    '',
    `작업 요청:\n${request}`,
    '',
    `Claude 의견: ${JSON.stringify(opinions.claude)}`,
    `Codex 의견: ${JSON.stringify(opinions.codex)}`,
  ].join('\n');
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const s = body.indexOf('{');
  const e = body.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(body.slice(s, e + 1));
  } catch {
    return null;
  }
}

export function parseOpinion(text: string): Opinion | null {
  const o = extractJson(text) as Record<string, unknown> | null;
  if (!o || typeof o.approach !== 'string' || typeof o.reason !== 'string') return null;
  if (o.fit !== 'me' && o.fit !== 'other' && o.fit !== 'either') return null;
  const d = Number(o.difficulty);
  return {
    approach: o.approach,
    reason: o.reason,
    fit: o.fit,
    difficulty: Number.isFinite(d) ? Math.min(5, Math.max(1, Math.round(d))) : 3,
  };
}

export function parseDecision(text: string): Decision | null {
  const o = extractJson(text) as Record<string, unknown> | null;
  if (!o || (o.assignee !== 'claude' && o.assignee !== 'codex')) return null;
  if (typeof o.reason !== 'string' || typeof o.plan !== 'string') return null;
  return { assignee: o.assignee, reason: o.reason, plan: o.plan };
}

const isOpinion = (r: OpinionResult | undefined): r is Opinion => !!r && !('error' in r);

function pick(self: AgentId, fit: Opinion['fit']): AgentId | null {
  if (fit === 'me') return self;
  if (fit === 'other') return other(self);
  return null;
}

export function decideByRule(ops: Partial<Record<AgentId, OpinionResult>>): Decision | 'need-decider' | 'manual' {
  const valid = AGENTS.filter((a) => isOpinion(ops[a]));
  if (valid.length === 0) return 'manual';
  if (valid.length === 1) {
    const a = valid[0];
    const o = ops[a] as Opinion;
    return { assignee: pick(a, o.fit) ?? a, reason: o.reason, plan: o.approach };
  }
  const [p1, p2] = valid.map((a) => pick(a, (ops[a] as Opinion).fit));
  if (p1 && p1 === p2) {
    return { assignee: p1, reason: `두 AI 모두 ${p1}를 추천`, plan: (ops[p1] as Opinion).approach };
  }
  return 'need-decider';
}

export type RunOnce = (
  adapter: Adapter,
  args: string[],
  cwd: string,
) => Promise<{ finalText: string; usage: Usage; error?: string }>;

const OPINION_TIMEOUT_MS = 3 * 60 * 1000;

export const runOnce: RunOnce = async (adapter, args, cwd) => {
  let finalText = '';
  const usage: Usage = {};
  let error: string | undefined;
  const h = runProcess(adapter.command(), args, cwd, (line) => {
    const p = adapter.parseLine(line);
    if (p.finalText) finalText = p.finalText;
    addUsage(usage, p.usageDelta);
    if (p.outcome && 'message' in p.outcome) error = p.outcome.message;
  });
  const timer = setTimeout(() => {
    error = '시간 초과';
    h.kill();
  }, OPINION_TIMEOUT_MS);
  const res = await h.done;
  clearTimeout(timer);
  if (res.spawnError) error = `CLI를 찾을 수 없습니다: ${res.spawnError}`;
  else if (!error && res.code !== 0) error = res.stderr.trim().slice(-300) || `종료 코드 ${res.code}`;
  return { finalText, usage, error };
};

export class Consultant {
  constructor(
    private store: TaskStore,
    private adapters: Record<AgentId, Adapter>,
    private emit: Emitter,
    private run: RunOnce = runOnce,
  ) {}

  private publish(task: Task): void {
    this.store.save(task);
    this.emit.update(task);
  }

  async consult(id: string): Promise<void> {
    const task = this.store.get(id);
    if (!task) return;
    task.status = 'consulting';
    task.consult = { opinions: {} };
    this.publish(task);

    const limited = AGENTS.find((a) => this.store.recentlyLimited(a));
    if (limited) {
      task.consult.decision = {
        assignee: other(limited),
        reason: `${limited}가 최근 사용량 한도에 걸려 있어 상의 없이 배정`,
        plan: '',
      };
      return this.publish(task);
    }

    // ponytail: 상의 중 취소해도 의견 프로세스는 끝까지 돈다(읽기 전용·상한·3분 제한이 있어 피해가 작음)
    const results = await Promise.all(
      AGENTS.map(async (a) => {
        const ad = this.adapters[a];
        const r = await this.run(ad, ad.opinionArgs(opinionPrompt(a, task.prompt), task.repo), task.repo);
        addUsage(task.usage, r.usage);
        const parsed = r.error ? null : parseOpinion(r.finalText);
        return [a, parsed ?? { error: r.error ?? '의견 JSON을 읽지 못함' }] as const;
      }),
    );
    if (task.status !== 'consulting') return;
    task.consult.opinions = Object.fromEntries(results) as Partial<Record<AgentId, OpinionResult>>;

    const rule = decideByRule(task.consult.opinions);
    if (rule === 'need-decider') {
      const claude = this.adapters.claude;
      const ops = task.consult.opinions as Record<AgentId, Opinion>;
      const r = await this.run(claude, claude.opinionArgs(decidePrompt(task.prompt, ops), task.repo), task.repo);
      addUsage(task.usage, r.usage);
      if (task.status !== 'consulting') return;
      const d = r.error ? null : parseDecision(r.finalText);
      if (d) task.consult.decision = d;
    } else if (rule !== 'manual') {
      task.consult.decision = rule;
    }
    this.publish(task);
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/main/consultant.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/consultant.ts src/main/consultant.test.ts
git commit -m "feat: 두 AI 상의로 담당 정하기"
```

---

### Task 11: 메인 프로세스 연결 (IPC + preload)

**Files:**
- Modify: `src/main/index.ts` (전체 교체)
- Modify: `src/preload/index.ts` (전체 교체)

**Interfaces:**
- Consumes: `TaskStore`, `TaskRunner`, `Emitter`, `Consultant`, `claudeAdapter`, `codexAdapter`, `repoRoot`, `isDirty`, 공용 타입 전부
- Produces: `window.desk: DeskApi`. IPC 채널 이름은 DeskApi 메서드 이름과 같고, 이벤트 채널은 `task:update`, `task:event`

- [ ] **Step 1: index.ts 교체**

`src/main/index.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import type { AgentEvent, AgentId, NewTaskInput, Task } from '../shared/types';
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
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  const dataDir = app.getPath('userData');
  const store = new TaskStore(join(dataDir, 'tasks.json'));
  store.markInterrupted();
  const adapters = { claude: claudeAdapter, codex: codexAdapter };
  const emitter: Emitter = {
    update: (t: Task) => win?.webContents.send('task:update', t),
    event: (id: string, e: AgentEvent) => win?.webContents.send('task:event', id, e),
  };
  const runner = new TaskRunner(store, adapters, emitter, join(dataDir, 'logs'));
  const consultant = new Consultant(store, adapters, emitter);

  const mustGet = (id: string): Task => {
    const t = store.get(id);
    if (!t) throw new Error(`작업을 찾을 수 없습니다: ${id}`);
    return t;
  };

  ipcMain.handle('listTasks', () => store.list());
  ipcMain.handle('getEvents', (_e, id: string) => runner.readEvents(id));

  ipcMain.handle('createTask', async (_e, input: NewTaskInput) => {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error('지시문을 입력하세요');
    if (!(input.budgetUsd > 0 && input.budgetUsd <= 50)) throw new Error('사용량 상한은 0보다 크고 50 이하여야 합니다');
    const root = await repoRoot(input.repo);
    if (!root) throw new Error('git 저장소가 아닙니다');
    const consult = input.agent === 'consult';
    const task: Task = {
      id: randomUUID().slice(0, 8),
      repo: root,
      prompt,
      agent: consult ? null : (input.agent as AgentId),
      budgetUsd: input.budgetUsd,
      status: consult ? 'consulting' : 'running',
      usage: {},
      createdAt: new Date().toISOString(),
    };
    store.save(task);
    emitter.update(task);
    if (consult) void consultant.consult(task.id);
    else void runner.start(task.id);
    return task;
  });

  ipcMain.handle('confirmTask', (_e, id: string, agent: AgentId) => {
    const task = mustGet(id);
    if (task.status !== 'consulting') throw new Error('상의 중인 작업만 확정할 수 있습니다');
    task.agent = agent;
    store.save(task);
    void runner.start(id);
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

  ipcMain.handle('resumeTask', (_e, id: string, budgetUsd?: number) => {
    void runner.resume(id, budgetUsd).catch((err: Error) => dialog.showErrorBox('이어서 하기 실패', err.message));
  });
  ipcMain.handle('cleanupTask', (_e, id: string) => runner.cleanup(id));
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

  createWindow();
});

app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 2: preload 교체**

`src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { AgentEvent, DeskApi, Task } from '../shared/types';

const call = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(ch, ...args);

const api: DeskApi = {
  listTasks: call('listTasks') as DeskApi['listTasks'],
  getEvents: call('getEvents') as DeskApi['getEvents'],
  createTask: call('createTask') as DeskApi['createTask'],
  confirmTask: call('confirmTask') as DeskApi['confirmTask'],
  cancelTask: call('cancelTask') as DeskApi['cancelTask'],
  resumeTask: call('resumeTask') as DeskApi['resumeTask'],
  cleanupTask: call('cleanupTask') as DeskApi['cleanupTask'],
  openFolder: call('openFolder') as DeskApi['openFolder'],
  pickRepo: call('pickRepo') as DeskApi['pickRepo'],
  checkRepo: call('checkRepo') as DeskApi['checkRepo'],
  paidKeys: call('paidKeys') as DeskApi['paidKeys'],
  onTaskUpdate: (cb) => {
    const h = (_e: unknown, t: Task) => cb(t);
    ipcRenderer.on('task:update', h);
    return () => ipcRenderer.removeListener('task:update', h);
  },
  onTaskEvent: (cb) => {
    const h = (_e: unknown, id: string, ev: AgentEvent) => cb(id, ev);
    ipcRenderer.on('task:event', h);
    return () => ipcRenderer.removeListener('task:event', h);
  },
};

contextBridge.exposeInMainWorld('desk', api);
```

- [ ] **Step 3: 확인**

Run: `npm run typecheck` → Expected: 오류 없음
Run: `npm test` → Expected: 전체 PASS
Run: `npm start` → Expected: 창이 뜨고, 개발자 도구(Ctrl+Shift+I) 콘솔에서 `await window.desk.listTasks()`가 `[]`를 돌려준다

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "feat: 메인 프로세스 IPC와 preload API"
```

---

### Task 12: 화면

**Files:**
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/styles.css` (전체 교체)
- Create: `src/renderer/src/TaskList.tsx`, `src/renderer/src/TaskDetail.tsx`, `src/renderer/src/NewTaskDialog.tsx`, `src/renderer/src/ConsultView.tsx`

**Interfaces:**
- Consumes: `window.desk: DeskApi`, 공용 타입
- Produces: `TaskList.tsx`가 `STATUS_LABEL`, `usageText(t: Task): string`을 export (TaskDetail이 사용)

- [ ] **Step 1: App.tsx**

```tsx
import { useEffect, useState } from 'react';
import type { AgentEvent, Task } from '../../shared/types';
import { NewTaskDialog } from './NewTaskDialog';
import { TaskDetail } from './TaskDetail';
import { TaskList } from './TaskList';

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, AgentEvent[]>>({});
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    window.desk.listTasks().then(setTasks);
    const offU = window.desk.onTaskUpdate((t) =>
      setTasks((prev) => [t, ...prev.filter((p) => p.id !== t.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    );
    const offE = window.desk.onTaskEvent((id, e) => setEvents((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), e] })));
    return () => {
      offU();
      offE();
    };
  }, []);

  const select = async (id: string) => {
    setSelected(id);
    const past = await window.desk.getEvents(id);
    setEvents((prev) => ({ ...prev, [id]: past }));
  };

  const task = tasks.find((t) => t.id === selected);
  return (
    <div className="layout">
      <aside className="sidebar">
        <button className="primary" onClick={() => setCreating(true)}>+ 새 작업</button>
        <TaskList tasks={tasks} selected={selected} onSelect={select} />
      </aside>
      <main className="detail">
        {task ? <TaskDetail task={task} events={events[task.id] ?? []} /> : <p className="empty">작업을 선택하거나 새로 보내세요.</p>}
      </main>
      {creating && (
        <NewTaskDialog
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            setCreating(false);
            setSelected(t.id);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: TaskList.tsx**

```tsx
import type { Task, TaskStatus } from '../../shared/types';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  consulting: '🤝 상의 중',
  running: '● 실행 중',
  done: '✓ 완료',
  failed: '✕ 실패',
  cancelled: '■ 중지',
  limited: '⏸ 한도 도달',
  interrupted: '⏸ 중단됨',
};

export function usageText(t: Task): string {
  const parts: string[] = [];
  if (t.usage.costUsd !== undefined) parts.push(`추정 $${t.usage.costUsd.toFixed(2)}`);
  if (t.usage.tokens !== undefined) parts.push(`토큰 ${Math.round(t.usage.tokens / 1000)}k`);
  return parts.join(' · ');
}

const AGENT_LABEL = { claude: 'Claude', codex: 'Codex' } as const;

export function TaskList(props: { tasks: Task[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <ul className="task-list">
      {props.tasks.map((t) => (
        <li key={t.id} className={t.id === props.selected ? 'active' : ''} onClick={() => props.onSelect(t.id)}>
          <div className="row1">
            <span className="agent">{t.agent ? AGENT_LABEL[t.agent] : '상의'}</span>
            <span className="title">{t.prompt.split('\n')[0]}</span>
          </div>
          <div className="row2">
            {STATUS_LABEL[t.status]} {usageText(t) && `· ${usageText(t)}`}
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: ConsultView.tsx**

```tsx
import type { AgentId, OpinionResult, Task } from '../../shared/types';

const NAMES: Record<AgentId, string> = { claude: 'Claude', codex: 'Codex' };
const otherOf = (a: AgentId): AgentId => (a === 'claude' ? 'codex' : 'claude');

function OpinionCard({ who, op }: { who: AgentId; op?: OpinionResult }) {
  return (
    <div className="opinion">
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
  const run = (agent: AgentId) => window.desk.confirmTask(task.id, agent).catch((e: Error) => alert(e.message));
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
      ) : (
        c &&
        Object.keys(c.opinions).length > 0 && (
          <div className="decision">
            <p>자동으로 정하지 못했습니다. 직접 골라 주세요.</p>
            <button onClick={() => run('claude')}>Claude로 실행</button>
            <button onClick={() => run('codex')}>Codex로 실행</button>
            <button onClick={cancel}>취소</button>
          </div>
        )
      )}
    </section>
  );
}
```

- [ ] **Step 4: TaskDetail.tsx**

```tsx
import { useState } from 'react';
import type { AgentEvent, Task } from '../../shared/types';
import { ConsultView } from './ConsultView';
import { STATUS_LABEL, usageText } from './TaskList';

function EventRow({ e }: { e: AgentEvent }) {
  const [open, setOpen] = useState(false);
  if (e.kind === 'text') return <div className="bubble">💬 {e.text}</div>;
  if (e.kind === 'tool')
    return (
      <div className="tool" onClick={() => setOpen(!open)}>
        🔧 {e.name} {open ? e.detail : e.detail.slice(0, 80)}
      </div>
    );
  if (e.kind === 'error') return <div className="err">⚠ {e.message}</div>;
  return <div className="raw">{e.line}</div>;
}

const FINISHED = ['done', 'failed', 'cancelled', 'limited', 'interrupted'];

export function TaskDetail({ task, events }: { task: Task; events: AgentEvent[] }) {
  const [budget, setBudget] = useState(task.budgetUsd * 2);
  const canResume = (task.status === 'limited' || task.status === 'interrupted') && !!task.sessionId && !!task.worktree;
  const act = (p: Promise<unknown>) => p.catch((err: Error) => alert(err.message));

  return (
    <div className="task-detail">
      <header>
        <div>
          {task.agent ? (task.agent === 'claude' ? 'Claude' : 'Codex') : '상의'} · {task.repo} {task.branch && `· ${task.branch}`}
          <span className="status"> {STATUS_LABEL[task.status]}</span>
        </div>
        <div>
          {usageText(task)}
          {task.agent === 'claude' && ` / 상한 $${task.budgetUsd.toFixed(2)} (API 환산 추정)`}
          {task.status === 'running' && <button onClick={() => act(window.desk.cancelTask(task.id))}>중지</button>}
        </div>
        {task.error && <p className="err">{task.error}</p>}
        {task.resetHint && <p>{task.resetHint} 재개 가능</p>}
        {canResume && (
          <p>
            {task.agent === 'claude' && (
              <label>
                상한 $<input type="number" min={0.1} step={0.5} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
              </label>
            )}
            <button className="primary" onClick={() => act(window.desk.resumeTask(task.id, task.agent === 'claude' ? budget : undefined))}>
              이어서 하기
            </button>
          </p>
        )}
      </header>

      {task.status === 'consulting' && <ConsultView task={task} />}

      <section className="log">
        {events.map((e, i) => (
          <EventRow key={i} e={e} />
        ))}
      </section>

      {FINISHED.includes(task.status) && task.worktree && (
        <footer>
          <p>
            바뀐 파일 {task.changedFiles?.length ?? 0}개 {task.diffStat}
          </p>
          <ul>{task.changedFiles?.map((f) => <li key={f}>{f}</li>)}</ul>
          <button onClick={() => act(window.desk.openFolder(task.id))}>폴더 열기</button>
          <button
            onClick={() => {
              if (confirm('worktree와 tm/ 브랜치를 삭제합니다. 커밋하지 않은 변경은 사라집니다. 계속할까요?')) {
                act(window.desk.cleanupTask(task.id));
              }
            }}
          >
            정리
          </button>
        </footer>
      )}
    </div>
  );
}
```

- [ ] **Step 5: NewTaskDialog.tsx**

```tsx
import { useEffect, useState } from 'react';
import type { AgentId, Task } from '../../shared/types';

const DEFAULT_REPO = 'C:\\Users\\you\\Capstone';
const REPO_KEY = 'agent-desk:lastRepo';

function loadRepo(): string {
  try {
    return localStorage.getItem(REPO_KEY) ?? DEFAULT_REPO;
  } catch {
    return DEFAULT_REPO;
  }
}

export function NewTaskDialog(props: { onClose: () => void; onCreated: (t: Task) => void }) {
  const [repo, setRepo] = useState(loadRepo);
  const [agent, setAgent] = useState<AgentId | 'consult'>('consult');
  const [prompt, setPrompt] = useState('');
  const [budget, setBudget] = useState(2);
  const [check, setCheck] = useState<{ root: string | null; dirty: boolean } | null>(null);
  const [paid, setPaid] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    window.desk.checkRepo(repo).then(setCheck);
  }, [repo]);
  useEffect(() => {
    window.desk.paidKeys().then(setPaid);
  }, []);

  const submit = async () => {
    setError('');
    try {
      const t = await window.desk.createTask({ repo, prompt, agent, budgetUsd: budget });
      try {
        localStorage.setItem(REPO_KEY, repo);
      } catch {
        // 저장 실패해도 동작에는 영향 없음
      }
      props.onCreated(t);
    } catch (e) {
      setError((e as Error).message);
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
        <label>
          저장소
          <div className="row">
            <input value={repo} onChange={(e) => setRepo(e.target.value)} />
            <button onClick={pick}>찾기</button>
          </div>
        </label>
        {check && !check.root && <p className="err">git 저장소가 아닙니다.</p>}
        {check?.dirty && <p className="warn">커밋하지 않은 변경이 있습니다. 이 변경은 작업에 포함되지 않습니다.</p>}

        <div className="agents">
          {(['consult', 'claude', 'codex'] as const).map((a) => (
            <label key={a}>
              <input type="radio" checked={agent === a} onChange={() => setAgent(a)} />
              {a === 'consult' ? '상의해서 정하기' : a === 'claude' ? 'Claude' : 'Codex'}
            </label>
          ))}
        </div>

        <textarea rows={8} placeholder="맡길 작업을 적어 주세요" value={prompt} onChange={(e) => setPrompt(e.target.value)} />

        {agent !== 'codex' && (
          <label>
            사용량 상한 (API 환산 추정 $, Claude 실행 시)
            <input type="number" min={0.1} max={50} step={0.5} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
          </label>
        )}
        {paid.length > 0 && <p className="warn">{paid.join(', ')} 환경변수가 설정돼 있어 구독 대신 종량제로 결제됩니다.</p>}
        {error && <p className="err">{error}</p>}

        <div className="row end">
          <button onClick={props.onClose}>닫기</button>
          <button className="primary" disabled={!prompt.trim() || !check?.root} onClick={submit}>
            보내기
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: styles.css 교체**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Segoe UI', 'Malgun Gothic', sans-serif; font-size: 14px; color: #1f2328; background: #fff; }
button { padding: 6px 12px; margin-right: 6px; border: 1px solid #d0d7de; border-radius: 6px; background: #f6f8fa; cursor: pointer; }
button.primary { background: #1f6feb; color: #fff; border-color: #1f6feb; }
button:disabled { opacity: 0.5; cursor: default; }
input, textarea { width: 100%; padding: 6px; border: 1px solid #d0d7de; border-radius: 6px; font: inherit; }
pre { white-space: pre-wrap; background: #f6f8fa; padding: 8px; border-radius: 6px; }
.layout { display: grid; grid-template-columns: 300px 1fr; height: 100vh; }
.sidebar { border-right: 1px solid #d0d7de; padding: 12px; overflow-y: auto; }
.task-list { list-style: none; padding: 0; margin: 12px 0 0; }
.task-list li { padding: 8px; border-radius: 6px; cursor: pointer; }
.task-list li.active { background: #ddf4ff; }
.task-list .row1 { display: flex; gap: 6px; }
.task-list .agent { font-weight: 600; }
.task-list .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-list .row2 { color: #656d76; font-size: 12px; }
.detail { overflow-y: auto; padding: 16px; }
.empty { color: #656d76; }
.task-detail header { border-bottom: 1px solid #d0d7de; padding-bottom: 8px; display: grid; gap: 4px; }
.log { padding: 8px 0; display: grid; gap: 6px; }
.bubble { background: #f6f8fa; padding: 8px; border-radius: 8px; white-space: pre-wrap; }
.tool { color: #656d76; font-family: Consolas, monospace; cursor: pointer; }
.raw { color: #8c959f; font-family: Consolas, monospace; font-size: 12px; }
.err { color: #cf222e; }
.warn { color: #9a6700; }
.opinions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.opinion { border: 1px solid #d0d7de; border-radius: 8px; padding: 8px; }
.decision { margin-top: 12px; }
.modal { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.3); display: grid; place-items: center; }
.dialog { background: #fff; padding: 16px; border-radius: 8px; width: 560px; display: grid; gap: 10px; }
.row { display: flex; gap: 6px; }
.row.end { justify-content: flex-end; }
.agents { display: flex; gap: 16px; }
.agents input { width: auto; }
```

- [ ] **Step 7: 확인**

Run: `npm run typecheck` → Expected: 오류 없음
Run: `npm test` → Expected: 전체 PASS
Run: `npm start` → Expected: 왼쪽 [+ 새 작업]과 빈 목록, 오른쪽 안내 문구. [+ 새 작업]을 누르면 저장소 기본값 `C:\Users\you\Capstone`, 담당 AI 세 가지, 지시문 입력, 상한이 보인다. Capstone에 커밋 안 된 변경이 있으면 노란 경고가 뜬다. 이 단계에서는 보내기를 누르지 않는다(Task 13에서 실제 실행)

- [ ] **Step 8: Commit**

```bash
git add src/renderer
git commit -m "feat: 작업 목록·상세·새 작업·상의 화면"
```

---

### Task 13: 실제 동작 확인

**사용량을 쓰는 단계다. 시작 전에 사용자에게 확인받는다.** 대상은 Capstone이 아니라 Task 2의 `.spike/repo`로 한다.

- [ ] **Step 1: Claude 직접 지정**

`npm start` → [+ 새 작업] → 저장소 `C:\Users\you\tool_manager\agent-desk\.spike\repo`, Claude, 지시문 `README.md 끝에 "checked by claude" 한 줄을 추가해줘`, 상한 0.5 → 보내기

Expected: 실시간 로그에 말풍선·도구 줄이 뜨고, 완료 후 바뀐 파일 `README.md`와 추정 금액이 표시된다. [폴더 열기]로 worktree가 열리고, 원본 `.spike/repo/README.md`는 그대로다

- [ ] **Step 2: Codex 직접 지정**

같은 저장소, Codex, `README.md 끝에 "checked by codex" 한 줄을 추가해줘`

Expected: 완료 후 바뀐 파일과 토큰 수 표시. 무료 한도에 걸리면 `⏸ 한도 도달`과 오류 문구가 보이는지 확인

- [ ] **Step 3: 상의 모드**

같은 저장소, 상의해서 정하기, `README.md를 한국어로 번역해줘`

Expected: `🤝 상의 중` → 두 의견 카드 → 결정과 [이대로 실행] / [다른 AI로 실행] / [취소]. [이대로 실행]을 누르면 담당 AI로 실행된다

- [ ] **Step 4: 중지·정리·재시작**

- 실행 중인 작업에서 [중지] → `■ 중지`
- 끝난 작업에서 [정리] → 확인 후 worktree 폴더와 `tm/` 브랜치가 사라진다(`git -C .spike/repo branch`로 확인)
- 실행 중에 앱을 닫았다가 다시 열기 → 그 작업이 `⏸ 중단됨`, 세션 ID가 있으면 [이어서 하기]가 보인다

- [ ] **Step 5: 결과 기록과 Commit**

확인 결과(동작함 / 문제와 원인)를 `docs/cli-notes.md` 아래에 "실제 동작 확인 (날짜)" 절로 적는다. 문제가 있으면 원인을 찾아 해당 Task의 테스트를 먼저 추가하고 고친다.

```bash
git add docs/cli-notes.md
git commit -m "docs: 실제 동작 확인 결과"
```
