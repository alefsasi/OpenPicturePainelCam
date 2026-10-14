// Servidor HTTP: arquivos estáticos + API de configuração + proxy de snapshots
// + WebSocket de vídeo em tempo real (opcional, via FFmpeg).
// O navegador nunca recebe IP/usuário/senha para falar com a câmera: quem
// autentica (Digest no snapshot, RTSP no tempo real) é este servidor.
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CameraError, createCameraClient } from './camera-client.js';
import { ValidationError, createConfigStore } from './config-store.js';
import { buildRtspUrl, createStreamHub } from './stream-hub.js';
import { attachWebSocket } from './websocket.js';
import { APP_ID } from './runtime.js';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const MAX_BODY = 64 * 1024;
const MAX_WATCH = 32; // câmeras por conexão WebSocket
const MAX_BUFFERED = 512 * 1024; // acima disso o cliente está lento: descarta quadros em vez de acumular atraso

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload ?? {});
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function readJson(req) {
  // Exigir JSON impede que outra página (CSRF via <form>) altere a configuração.
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw new ValidationError('Content-Type deve ser application/json', 415);
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ValidationError('Corpo da requisição grande demais', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new ValidationError('JSON inválido');
  }
}

async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = normalize(join(PUBLIC_DIR, rel));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + sep)) return sendJson(res, 403, { error: 'Proibido' });
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'Não encontrado' });
  }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function createServer({ configPath, timeoutMs, ffmpegPath, spawn, streamOptions, onShutdown, appId = APP_ID } = {}) {
  const store = createConfigStore(configPath);
  const cameras = createCameraClient({ timeoutMs });
  const hub = createStreamHub({ ffmpegPath, spawn, ...streamOptions });

  /** Visão pública + se o servidor consegue transmitir em tempo real (FFmpeg presente). */
  function view() {
    const pub = store.getPublic();
    return { ...pub, realtime: { ...pub.realtime, available: hub.available } };
  }

  /** Fonte do vídeo ao vivo, lida de novo a cada (re)início para refletir a config atual. */
  function realtimeSource(id) {
    const cam = store.getCamera(id);
    const { fps, maxWidth } = store.getRealtime();
    return { url: buildRtspUrl(cam, store.credentialsFor(cam)), fps, width: maxWidth };
  }

  /**
   * Um WebSocket por navegador leva todas as câmeras em tempo real da tela.
   * Cliente -> servidor: {"watch": ["id", ...]} (lista completa do que está visível).
   * Servidor -> cliente: texto {"id","state":"live"|"error","message"} e
   * binário [1 byte: tamanho do id][id][JPEG].
   */
  function handleStream(conn) {
    const watching = new Map(); // id -> cancelar assinatura
    let queue = Promise.resolve();

    function watch(id) {
      const prefix = Buffer.concat([Buffer.from([Buffer.byteLength(id)]), Buffer.from(id)]);
      const send = (payload) => conn.sendText(JSON.stringify({ id, ...payload }));
      try {
        watching.set(id, hub.subscribe(id, () => realtimeSource(id), {
          onFrame: (frame) => { if (conn.buffered < MAX_BUFFERED) conn.sendBinary(prefix, frame); },
          onStatus: (state, message) => send({ state, message }),
        }));
      } catch (err) {
        send({ state: 'error', message: err.message });
      }
    }

    async function update(ids) {
      const wanted = new Set(ids.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 64).slice(0, MAX_WATCH));
      for (const [id, cancel] of watching) {
        if (!wanted.has(id)) { cancel(); watching.delete(id); }
      }
      const ok = await hub.ready;
      for (const id of wanted) {
        if (conn.closed || conn.closing) return;
        if (!ok) conn.sendText(JSON.stringify({ id, state: 'error', message: 'FFmpeg não encontrado no servidor' }));
        else if (!watching.has(id)) watch(id);
      }
    }

    conn.on('message', (text) => {
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      if (Array.isArray(msg?.watch)) queue = queue.then(() => update(msg.watch)).catch(() => {});
    });
    conn.on('close', () => {
      for (const cancel of watching.values()) cancel();
      watching.clear();
    });
  }

  async function snapshot(id, req, res) {
    const cam = store.getCamera(id);
    // Se o navegador desistir (trocou de página), cancela a chamada à câmera.
    const aborter = new AbortController();
    res.on('close', () => { if (!res.writableEnded) aborter.abort(); });
    try {
      // `?force=1` (botão "Testar") ignora a pausa por senha recusada e tenta uma vez.
      const force = new URL(req.url, 'http://localhost').searchParams.get('force') === '1';
      const { body, type } = await cameras.fetchSnapshot(cam, store.credentialsFor(cam), { signal: aborter.signal, force });
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store' });
      res.end(body);
    } catch (err) {
      if (aborter.signal.aborted) return;
      throw err;
    }
  }

  async function api(req, res, parts) {
    const [, resource, id, action] = parts; // ['api', recurso, id, ação]
    const { method } = req;

    // Usados pela CLI (`status`/`stop`) para confirmar que o PID registrado é mesmo o painel.
    if (resource === 'ping' && method === 'GET') return sendJson(res, 200, { app: appId, pid: process.pid });

    if (resource === 'shutdown' && method === 'POST' && onShutdown) {
      // Só o próprio computador pode mandar parar (mesmo com HOST=0.0.0.0) e é preciso
      // citar o PID certo; o corpo JSON também barra formulários de outros sites (CSRF).
      if (!LOOPBACK.has(req.socket.remoteAddress)) throw new ValidationError('Apenas o próprio computador pode parar o painel', 403);
      if ((await readJson(req)).pid !== process.pid) throw new ValidationError('PID não confere');
      sendJson(res, 200, { ok: true });
      res.on('finish', () => setImmediate(onShutdown));
      return;
    }

    if (resource === 'config' && method === 'GET') {
      await hub.ready; // a primeira resposta já sabe se há FFmpeg
      return sendJson(res, 200, view());
    }

    if (resource === 'settings' && method === 'PUT') {
      store.updateSettings(await readJson(req));
      hub.resetAll(); // credenciais globais, fps e largura valem para todos os streams
      return sendJson(res, 200, view());
    }

    if (resource === 'cameras') {
      if (!id && method === 'POST') {
        const newId = store.addCamera(await readJson(req));
        return sendJson(res, 201, { id: newId });
      }
      if (id === 'order' && method === 'PUT') {
        store.reorder((await readJson(req)).ids);
        return sendJson(res, 200, view());
      }
      if (id && action === 'snapshot' && method === 'GET') return snapshot(id, req, res);
      if (id && !action && method === 'PUT') {
        store.updateCamera(id, await readJson(req));
        hub.reset(id);
        return sendJson(res, 200, view());
      }
      if (id && !action && method === 'DELETE') {
        store.removeCamera(id);
        hub.reset(id);
        return sendJson(res, 200, view());
      }
    }
    sendJson(res, 404, { error: 'Rota não encontrada' });
  }

  const server = createHttpServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts[0] === 'api') return await api(req, res, parts);
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Método não permitido' });
      await serveStatic(pathname, res);
    } catch (err) {
      if (res.headersSent) return res.destroy();
      if (err instanceof ValidationError || err instanceof CameraError) {
        return sendJson(res, err.status, { error: err.message });
      }
      console.error(err);
      sendJson(res, 500, { error: 'Erro interno' });
    }
  });

  attachWebSocket(server, '/api/stream', handleStream);
  server.on('close', () => hub.closeAll());
  return server;
}
