import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface RunResult {
  code: number | null;
  stderr: string;
  spawnError?: string;
}

export interface RunHandle {
  kill(): void;
  pid?: number;
  done: Promise<RunResult>;
}

export function killTree(pid?: number): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    // taskkill을 못 찾는 환경에서도 메인 프로세스가 죽지 않게 오류를 받아 둔다
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
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
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(cmd, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (err) {
    // 인자에 NUL 문자가 있으면 spawn이 동기적으로 예외를 던진다
    return { kill: () => {}, done: Promise.resolve({ code: null, stderr: '', spawnError: (err as Error).message }) };
  }
  let stderr = '';
  child.stderr!.setEncoding('utf8'); // 청크 경계에서 한글이 깨지지 않게 스트림 디코더를 쓴다
  child.stderr!.on('data', (d: string) => {
    stderr = (stderr + d).slice(-4000);
  });
  const rl = createInterface({ input: child.stdout! });
  rl.on('line', (l) => onLine(l.replace(/\r$/, '')));

  const done = new Promise<RunResult>((resolve) => {
    child.on('error', (err) => resolve({ code: null, stderr, spawnError: err.message }));
    child.on('close', (code) => resolve({ code, stderr }));
  });
  return { kill: () => killTree(child.pid), pid: child.pid, done };
}

/** 실행 중인 프로세스의 이름(예: claude.exe). 없거나 확인할 수 없으면 null */
export function imageName(pid: number): string | null {
  if (process.platform !== 'win32') return null; // ponytail: Windows 전용 앱이라 다른 OS는 확인하지 않는다
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    const m = out.match(/^"([^"]+)","(\d+)"/m);
    return m && Number(m[2]) === pid ? m[1] : null;
  } catch {
    return null;
  }
}

const CLI_NAME = /^(claude|codex)(\.exe)?$/i;

/**
 * 앱이 강제 종료돼 남은 CLI를 끝낸다(설계 20절). PID는 다른 프로그램에 다시 쓰일 수 있어 이름이 claude·codex일 때만 끝낸다
 */
export function killOrphans(pids: number[], nameOf: (pid: number) => string | null = imageName, kill: (pid: number) => void = killTree): void {
  for (const pid of pids) {
    const name = nameOf(pid);
    if (name && CLI_NAME.test(name)) kill(pid);
  }
}
