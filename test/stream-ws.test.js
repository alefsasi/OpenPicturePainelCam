import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.js';
import { createFakeSpawn, fakeJpeg, waitFor } from '../test-support/fake-ffmpeg.js';

// O cliente WebSocket global só existe a partir do Node 22.
const skip = typeof WebSocket === 'undefined' ? 'WebSocket global indisponível neste Node' : false;

let panel; let dir; let base; let port; let fake; let cameraId;

const api = (path, method = 'GET', body) => fetch(base + path, {
  method,
  headers: body ? { 'Content-Type': 'application/json' } : undefined,
  body: body && JSON.stringify(body),
});

function openStream() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/stream`);
  ws.binaryType = 'arraybuffer';
  const texts = [];
  const frames = [];
  ws.addEventListener('message', (e) => {
    if (typeof e.data === 'string') texts.push(JSON.parse(e.data));
    else frames.push(Buffer.from(e.data));
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  return { ws, texts, frames, opened };
}

before(async () => {
  fake = createFakeSpawn();
  dir = mkdtempSync(join(tmpdir(), 'cams-ws-'));
  panel = createServer({
    configPath: join(dir, 'config.json'),
    ffmpegPath: 'fake-ffmpeg',
    spawn: fake.spawn,
    streamOptions: { idleMs: 30 },
  });
  await new Promise((resolve) => panel.listen(0, '127.0.0.1', resolve));
  port = panel.address().port;
  base = `http://127.0.0.1:${port}`;

  await api('/api/settings', 'PUT', {
    refreshDelayMs: 1000, auth: { username: 'u', password: 'p@ss' }, realtime: { fps: 12, maxWidth: 480 },
  });
  cameraId = (await (await api('/api/cameras', 'POST', { name: 'Live', ip: '10.0.0.9', rtspPort: 8554 })).json()).id;
});

after(() => {
  panel.closeAllConnections?.();
  panel.close();
  rmSync(dir, { recursive: true, force: true });
});

test('config informa que o tempo real está disponível', async () => {
  const cfg = await (await api('/api/config')).json();
  assert.equal(cfg.realtime.available, true);
  assert.equal(cfg.streamMode, 'snapshot'); // snapshot continua sendo o padrão
  assert.equal(cfg.cameras[0].rtspPort, 8554);
});

test('WebSocket entrega quadros da câmera pedida e FFmpeg usa o sub-stream com a config atual', { skip }, async () => {
  const { ws, texts, frames, opened } = openStream();
  await opened;
  ws.send(JSON.stringify({ watch: [cameraId] }));
  await waitFor(() => frames.length >= 2);

  // [1 byte: tamanho do id][id][JPEG]
  const idLength = frames[0][0];
  assert.equal(frames[0].subarray(1, 1 + idLength).toString(), cameraId);
  assert.deepEqual(frames[0].subarray(1 + idLength), fakeJpeg(0));
  assert.ok(texts.some((t) => t.id === cameraId && t.state === 'live'));

  const args = fake.calls.at(-1).args;
  assert.ok(args.includes('rtsp://u:p%40ss@10.0.0.9:8554/Streaming/Channels/102'));
  assert.match(args.join(' '), /fps=12,scale='min\(480,iw\)'/);

  ws.close();
  await waitFor(() => fake.calls.at(-1).killed); // sem espectadores, o FFmpeg para
});

test('câmera inexistente devolve erro pelo WebSocket', { skip }, async () => {
  const { ws, texts, opened } = openStream();
  await opened;
  ws.send(JSON.stringify({ watch: ['nao-existe'] }));
  await waitFor(() => texts.length > 0);
  assert.deepEqual(texts[0], { id: 'nao-existe', state: 'error', message: 'Câmera não encontrada' });
  ws.close();
});

test('recusa WebSocket vindo de outra origem (CSWSH)', async () => {
  const status = await new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path: '/api/stream',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64'),
        Origin: 'http://evil.example',
      },
    });
    req.on('response', (res) => { resolve(res.statusCode); res.resume(); });
    req.on('upgrade', () => resolve(101));
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('sem FFmpeg o painel informa indisponível e o WebSocket responde com erro', { skip }, async () => {
  const noFfmpeg = createServer({
    configPath: join(dir, 'other.json'),
    spawn: createFakeSpawn({ behavior: 'missing' }).spawn,
  });
  await new Promise((resolve) => noFfmpeg.listen(0, '127.0.0.1', resolve));
  const p = noFfmpeg.address().port;
  try {
    const cfg = await (await fetch(`http://127.0.0.1:${p}/api/config`)).json();
    assert.equal(cfg.realtime.available, false);

    const ws = new WebSocket(`ws://127.0.0.1:${p}/api/stream`);
    const messages = [];
    ws.addEventListener('message', (e) => messages.push(JSON.parse(e.data)));
    await new Promise((resolve) => ws.addEventListener('open', resolve));
    ws.send(JSON.stringify({ watch: ['x'] }));
    await waitFor(() => messages.length > 0);
    assert.equal(messages[0].message, 'FFmpeg não encontrado no servidor');
    ws.close();
  } finally {
    noFfmpeg.closeAllConnections?.();
    noFfmpeg.close();
  }
});
