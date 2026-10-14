// Servidor HTTP: arquivos estáticos + API de configuração + proxy de snapshots.
// O navegador nunca recebe IP/usuário/senha para falar com a câmera: quem
// autentica (Digest) é este servidor.
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CameraError, createCameraClient } from './camera-client.js';
import { ValidationError, createConfigStore } from './config-store.js';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const MAX_BODY = 64 * 1024;

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

export function createServer({ configPath, timeoutMs } = {}) {
  const store = createConfigStore(configPath);
  const cameras = createCameraClient({ timeoutMs });

  async function snapshot(id, req, res) {
    const cam = store.getCamera(id);
    // Se o navegador desistir (trocou de página), cancela a chamada à câmera.
    const aborter = new AbortController();
    res.on('close', () => { if (!res.writableEnded) aborter.abort(); });
    try {
      const { body, type } = await cameras.fetchSnapshot(cam, store.credentialsFor(cam), { signal: aborter.signal });
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

    if (resource === 'config' && method === 'GET') return sendJson(res, 200, store.getPublic());

    if (resource === 'settings' && method === 'PUT') {
      store.updateSettings(await readJson(req));
      return sendJson(res, 200, store.getPublic());
    }

    if (resource === 'cameras') {
      if (!id && method === 'POST') {
        const newId = store.addCamera(await readJson(req));
        return sendJson(res, 201, { id: newId });
      }
      if (id === 'order' && method === 'PUT') {
        store.reorder((await readJson(req)).ids);
        return sendJson(res, 200, store.getPublic());
      }
      if (id && action === 'snapshot' && method === 'GET') return snapshot(id, req, res);
      if (id && !action && method === 'PUT') {
        store.updateCamera(id, await readJson(req));
        return sendJson(res, 200, store.getPublic());
      }
      if (id && !action && method === 'DELETE') {
        store.removeCamera(id);
        return sendJson(res, 200, store.getPublic());
      }
    }
    sendJson(res, 404, { error: 'Rota não encontrada' });
  }

  return createHttpServer(async (req, res) => {
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
}
