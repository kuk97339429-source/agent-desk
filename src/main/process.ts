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
  return { kill: () => killTree(child.pid), done };
}
