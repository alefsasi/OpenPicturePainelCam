import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRtspUrl, createStreamHub, ffmpegArgs } from '../src/stream-hub.js';
import { createFakeSpawn, fakeJpeg, sleep, waitFor } from '../test-support/fake-ffmpeg.js';

const source = () => ({ url: 'rtsp://u:secret@10.0.0.5:554/Streaming/Channels/102', fps: 10, width: 640 });

function listener() {
  const l = { frames: [], statuses: [], onFrame: (f) => l.frames.push(Buffer.from(f)), onStatus: (...s) => l.statuses.push(s) };
  return l;
}

test('buildRtspUrl: sub-stream, porta própria e credenciais codificadas', () => {
  assert.equal(
    buildRtspUrl({ ip: '192.168.0.10:8080', rtspPort: null }, { username: 'admin', password: 'p@ss:w/rd' }),
    'rtsp://admin:p%40ss%3Aw%2Frd@192.168.0.10:554/Streaming/Channels/102',
  );
  assert.equal(buildRtspUrl({ ip: 'cam.local', rtspPort: 8554 }, { username: '', password: '' }),
    'rtsp://cam.local:8554/Streaming/Channels/102');
  assert.equal(buildRtspUrl({ ip: '[fe80::1]:80', rtspPort: null }, { username: '', password: '' }),
    'rtsp://[fe80::1]:554/Streaming/Channels/102');
});

test('ffmpegArgs: TCP, baixa latência, fps/largura limitados e sem áudio', () => {
  const args = ffmpegArgs({ url: 'rtsp://x', fps: 8, width: 480 });
  const joined = args.join(' ');
  assert.match(joined, /-rtsp_transport tcp/);
  assert.match(joined, /-fflags nobuffer\+discardcorrupt -flags low_delay/);
  assert.match(joined, /fps=8,scale='min\(480,iw\)':-2/);
  assert.ok(args.includes('-an'));
  assert.equal(args[args.indexOf('-i') + 1], 'rtsp://x');
});

test('um único processo atende vários espectadores e entrega os quadros', async () => {
  const { spawn, calls } = createFakeSpawn();
  const hub = createStreamHub({ spawn, idleMs: 20 });
  assert.equal(await hub.ready, true);

  const a = listener();
  const b = listener();
  const offA = hub.subscribe('cam1', source, a);
  const offB = hub.subscribe('cam1', source, b);
  await waitFor(() => a.frames.length >= 3 && b.frames.length >= 3);

  assert.equal(calls.length, 1);
  assert.deepEqual(a.frames[0], fakeJpeg(0));
  assert.deepEqual(a.statuses[0], ['live']);
  assert.ok(calls[0].args.includes('rtsp://u:secret@10.0.0.5:554/Streaming/Channels/102'));

  offA(); offB();
  hub.closeAll();
});

test('encerra o FFmpeg quando o último espectador sai e reinicia ao voltar', async () => {
  const { spawn, calls } = createFakeSpawn();
  const hub = createStreamHub({ spawn, idleMs: 30 });
  await hub.ready;

  const off = hub.subscribe('cam1', source, listener());
  await waitFor(() => calls.length === 1);
  off();
  await waitFor(() => calls[0].killed); // parou sozinho: ninguém assistindo = nenhum consumo

  hub.subscribe('cam1', source, listener());
  await waitFor(() => calls.length === 2);
  hub.closeAll();
});

test('quem entra depois recebe o último quadro na hora', async () => {
  const { spawn } = createFakeSpawn();
  const hub = createStreamHub({ spawn, idleMs: 20 });
  await hub.ready;

  const first = listener();
  hub.subscribe('cam1', source, first);
  await waitFor(() => first.frames.length >= 2);

  const late = listener();
  hub.subscribe('cam1', source, late);
  assert.equal(late.frames.length, 1); // síncrono, sem esperar o próximo quadro
  assert.deepEqual(late.statuses[0], ['live']);
  hub.closeAll();
});

test('falha de rede tenta de novo sozinha, sem vazar a senha', async () => {
  const { spawn, calls } = createFakeSpawn({
    behavior: (n) => (n === 1 ? 'fail' : 'frames'),
    stderr: '[rtsp @ 0x1] Connection refused rtsp://u:secret@10.0.0.5:554/x',
  });
  const hub = createStreamHub({ spawn, retryBaseMs: 10, idleMs: 20 });
  await hub.ready;

  const l = listener();
  hub.subscribe('cam1', source, l);
  await waitFor(() => l.statuses.some(([state]) => state === 'live'));

  assert.equal(calls.length, 2); // reiniciou sozinho
  const error = l.statuses.find(([state]) => state === 'error');
  assert.equal(error[1], 'Falha ao conectar na câmera (RTSP)');
  assert.equal(JSON.stringify(l.statuses).includes('secret'), false);
  hub.closeAll();
});

test('senha recusada: uma única tentativa, sem retry nem nova tentativa ao reabrir (evita bloquear a câmera)', async () => {
  const { spawn, calls } = createFakeSpawn({
    behavior: 'fail',
    stderr: '[rtsp @ 0x1] method DESCRIBE failed: 401 Unauthorized rtsp://u:secret@10.0.0.5:554/x',
  });
  const hub = createStreamHub({ spawn, retryBaseMs: 5, idleMs: 10 });
  await hub.ready;

  const first = listener();
  const off = hub.subscribe('cam1', source, first);
  await waitFor(() => first.statuses.length > 0);
  await sleep(80); // tempo de sobra para um retry indevido acontecer
  assert.equal(calls.length, 1);
  assert.deepEqual(first.statuses, [['error', 'Usuário ou senha inválidos']]);
  assert.equal(JSON.stringify(first.statuses).includes('secret'), false);

  // O stream ocioso é descartado; abrir a página de novo não pode tentar o login outra vez.
  off();
  await sleep(40);
  const second = listener();
  hub.subscribe('cam1', source, second);
  assert.equal(calls.length, 1);
  assert.match(second.statuses[0][1], /Tentativas pausadas/);
  hub.closeAll();
});

test('credenciais novas ou reset liberam uma nova tentativa após senha recusada', async () => {
  const { spawn, calls } = createFakeSpawn({
    behavior: (n) => (n === 1 ? 'fail' : 'frames'),
    stderr: '401 Unauthorized',
  });
  const hub = createStreamHub({ spawn, retryBaseMs: 5, idleMs: 200 });
  await hub.ready;

  const l = listener();
  hub.subscribe('cam1', source, l);
  await waitFor(() => l.statuses.length > 0);
  assert.equal(calls.length, 1);

  hub.reset('cam1'); // o usuário salvou a configuração
  await waitFor(() => l.frames.length > 0);
  assert.equal(calls.length, 2);
  hub.closeAll();
});

test('URL com senha diferente não é afetada pela recusa de outra senha', async () => {
  const { spawn, calls } = createFakeSpawn({
    behavior: (n) => (n === 1 ? 'fail' : 'frames'),
    stderr: '401 Unauthorized',
  });
  const hub = createStreamHub({ spawn, retryBaseMs: 5, idleMs: 10 });
  await hub.ready;

  const wrong = listener();
  const off = hub.subscribe('cam1', () => ({ ...source(), url: 'rtsp://u:errada@10.0.0.5:554/x' }), wrong);
  await waitFor(() => wrong.statuses.length > 0);
  off();
  await sleep(40);

  const right = listener();
  hub.subscribe('cam1', () => ({ ...source(), url: 'rtsp://u:certa@10.0.0.5:554/x' }), right);
  await waitFor(() => right.frames.length > 0);
  assert.equal(calls.length, 2);
  hub.closeAll();
});

test('processo travado (sem quadros) é morto e reiniciado', async () => {
  const { spawn, calls } = createFakeSpawn({ behavior: (n) => (n === 1 ? 'silent' : 'frames') });
  const hub = createStreamHub({ spawn, stallMs: 40, retryBaseMs: 10, idleMs: 20 });
  await hub.ready;

  const l = listener();
  hub.subscribe('cam1', source, l);
  await waitFor(() => l.frames.length > 0);

  assert.equal(calls[0].killed, true);
  assert.equal(l.statuses.find(([state]) => state === 'error')[1], 'Sem imagem da câmera (tempo esgotado)');
  hub.closeAll();
});

test('FFmpeg ausente: indisponível, erro claro e sem loop de tentativas', async () => {
  const { spawn, calls } = createFakeSpawn({ behavior: 'missing' });
  const hub = createStreamHub({ spawn, retryBaseMs: 5, idleMs: 20 });
  assert.equal(await hub.ready, false);
  assert.equal(hub.available, false);

  const l = listener();
  hub.subscribe('cam1', source, l);
  await waitFor(() => l.statuses.length > 0);
  await sleep(60);

  assert.deepEqual(l.statuses, [['error', 'FFmpeg não encontrado no servidor']]);
  assert.equal(calls.length, 1);
  hub.closeAll();
});

test('reset reinicia o processo com a configuração atual', async () => {
  const { spawn, calls } = createFakeSpawn();
  const hub = createStreamHub({ spawn, idleMs: 20 });
  await hub.ready;

  const l = listener();
  hub.subscribe('cam1', source, l);
  await waitFor(() => l.frames.length > 0);
  hub.reset('cam1');
  await waitFor(() => calls.length === 2);
  assert.equal(calls[0].killed, true);
  hub.closeAll();
});

test('câmera removida (resolveSource lança) vira erro final', async () => {
  const { spawn, calls } = createFakeSpawn();
  const hub = createStreamHub({ spawn, idleMs: 20 });
  await hub.ready;

  const l = listener();
  hub.subscribe('gone', () => { throw new Error('Câmera não encontrada'); }, l);
  assert.deepEqual(l.statuses, [['error', 'Câmera não encontrada']]);
  assert.equal(calls.length, 0);
  hub.closeAll();
});

test('o timeout da sondagem não desfaz uma detecção bem-sucedida do FFmpeg', async () => {
  const { spawn } = createFakeSpawn();
  const hub = createStreamHub({ spawn, probeTimeoutMs: 30 });
  assert.equal(await hub.ready, true);
  await sleep(80); // passa do timeout
  assert.equal(hub.available, true);
});

test('respeita o limite de streams simultâneos', async () => {
  const { spawn } = createFakeSpawn();
  const hub = createStreamHub({ spawn, maxStreams: 1, idleMs: 20 });
  await hub.ready;
  hub.subscribe('a', source, listener());
  assert.throws(() => hub.subscribe('b', source, listener()), /Limite/);
  hub.closeAll();
});
