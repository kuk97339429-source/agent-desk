import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { runProcess } from './process';

const node = process.execPath;

describe('runProcess', () => {
  it('stdout을 줄 단위로 넘기고 CRLF의 \r을 제거한다', async () => {
    const lines: string[] = [];
    const h = runProcess(node, ['-e', "process.stdout.write('a\\r\\nb\\nc')"], tmpdir(), (l) => lines.push(l));
    const r = await h.done;
    expect(lines).toEqual(['a', 'b', 'c']);
    expect(r.code).toBe(0);
  });

  it('인자에 공백·따옴표·줄바꿈·한글이 있어도 한 원소로 전달한다', async () => {
    const lines: string[] = [];
    const arg = '-x "따옴표" \n둘째 줄';
    const h = runProcess(node, ['-e', 'console.log(JSON.stringify(process.argv[1]))', '--', arg], tmpdir(), (l) => lines.push(l));
    await h.done;
    expect(JSON.parse(lines[0])).toBe(arg);
  });

  it('stderr 끝부분과 종료 코드를 돌려준다', async () => {
    const h = runProcess(node, ['-e', "console.error('boom'); process.exit(3)"], tmpdir(), () => {});
    const r = await h.done;
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('boom');
  });

  it('stderr의 한글이 청크 경계에서 깨지지 않는다', async () => {
    // 3바이트 한글을 1000바이트씩(문자 중간에서) 잘라 시간 간격을 두고 보낸다
    const script =
      "const b = Buffer.from('가'.repeat(1000)); let i = 0;" +
      'const t = setInterval(() => { process.stderr.write(b.subarray(i, i + 1000)); i += 1000; if (i >= b.length) clearInterval(t); }, 5);';
    const h = runProcess(node, ['-e', script], tmpdir(), () => {});
    const r = await h.done;
    expect(r.stderr).not.toContain('�');
    expect(r.stderr.endsWith('가가가')).toBe(true);
  });

  it('인자에 NUL 문자가 있어도 예외 대신 spawnError로 돌려준다', async () => {
    const h = runProcess(node, ['-e', 'console.log(1)', 'a\u0000b'], tmpdir(), () => {});
    const r = await h.done;
    expect(r.spawnError).toBeTruthy();
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
