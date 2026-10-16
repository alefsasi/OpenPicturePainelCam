// `spawn` falso que imita o FFmpeg: permite testar o streaming sem o binário instalado.
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

/** JPEG mínimo válido para o separador (começa em FFD8, termina em FFD9, sem FFD9 no meio). */
export const fakeJpeg = (n) => Buffer.from([0xff, 0xd8, 0x01, n & 0x7f, 0x02, 0xff, 0xd9]);

/**
 * behavior:
 *  - 'frames'  emite um JPEG a cada `intervalMs` (padrão)
 *  - 'silent'  conecta mas nunca emite quadros
 *  - 'fail'    escreve `stderr` e sai com código 1
 *  - 'missing' dispara ENOENT, como um binário inexistente
 * `behavior` pode ser função (callNumber) => behavior para variar entre tentativas.
 */
export function createFakeSpawn({ behavior = 'frames', intervalMs = 10, stderr = '' } = {}) {
  const calls = []; // { command, args, killed }

  function spawn(command, args) {
    const call = { command, args, killed: false };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let timer = null;
    let exited = false;

    const exit = (code) => {
      if (exited) return;
      exited = true;
      clearInterval(timer);
      child.emit('exit', code, null);
    };
    child.kill = () => {
      call.killed = true;
      setImmediate(() => exit(null));
      return true;
    };

    if (args[0] === '-version') {
      const missing = (typeof behavior === 'function' ? behavior(0) : behavior) === 'missing';
      setImmediate(() => (missing
        ? child.emit('error', Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }))
        : exit(0)));
      return child;
    }

    calls.push(call);
    const mode = typeof behavior === 'function' ? behavior(calls.length) : behavior;
    if (mode === 'missing') {
      setImmediate(() => child.emit('error', Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' })));
    } else if (mode === 'fail') {
      setImmediate(() => {
        child.stderr.write(stderr);
        exit(1);
      });
    } else if (mode === 'frames') {
      let n = 0;
      timer = setInterval(() => {
        const frame = fakeJpeg(n++);
        // Quebra o quadro em dois pedaços para exercitar o separador.
        child.stdout.write(frame.subarray(0, 3));
        child.stdout.write(frame.subarray(3));
      }, intervalMs);
    }
    return child;
  }

  return { spawn, calls };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(condition, timeoutMs = 2000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor: tempo esgotado');
    await sleep(5);
  }
}
