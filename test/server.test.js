import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.js';
import { login } from '../test-support/login.js';

// Câmera falsa exigindo Digest. Credenciais fictícias, só para o teste.
const USER = 'test-user';
const PASS = 'test-pass';
const REALM = 'fake-cam';
const NONCE = 'abc123nonce';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
const md5 = (s) => createHash('md5').update(s).digest('hex');

let camera; let panel; let dir; let base; let camAddress; let cookie; let cameraRequests = 0;

function digestOk(header, uri) {
  if (!header?.startsWith('Digest ')) return false;
  const p = Object.fromEntries([...header.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)].map((m) => [m[1], m[2] ?? m[3]]));
  if (p.username !== USER || p.nonce !== NONCE || p.uri !== uri) return false;
  const expected = md5(`${md5(`${USER}:${REALM}:${PASS}`)}:${NONCE}:${p.nc}:${p.cnonce}:auth:${md5(`GET:${uri}`)}`);
  return p.response === expected;
}

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
// Chama o painel já logado (as alterações exigem sessão).
const call = (path, method = 'GET', body) => fetch(base + path, {
  method,
  headers: { ...(body && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
  body: body && JSON.stringify(body),
});

before(async () => {
  camera = createHttpServer((req, res) => {
    cameraRequests++;
    if (req.url !== '/ISAPI/Streaming/channels/102/picture') { res.writeHead(404).end(); return; }
    if (!digestOk(req.headers.authorization, req.url)) {
      res.writeHead(401, { 'WWW-Authenticate': `Digest realm="${REALM}", qop="auth", nonce="${NONCE}"` }).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(JPEG);
  });
  camAddress = `127.0.0.1:${await listen(camera)}`;

  dir = mkdtempSync(join(tmpdir(), 'cams-srv-'));
  panel = createServer({ configPath: join(dir, 'config.json'), timeoutMs: 1000 });
  base = `http://127.0.0.1:${await listen(panel)}`;
  cookie = await login(base);
});

after(() => {
  camera.close();
  panel.close();
  rmSync(dir, { recursive: true, force: true });
});

test('snapshot via Digest com credenciais globais, reaproveitando o nonce', async () => {
  await call('/api/settings', 'PUT', { refreshDelayMs: 1000, auth: { username: USER, password: PASS } });
  const created = await call('/api/cameras', 'POST', { name: 'Fake', ip: camAddress });
  assert.equal(created.status, 201);
  const { id } = await created.json();

  cameraRequests = 0;
  for (let i = 0; i < 3; i++) {
    const res = await call(`/api/cameras/${id}/snapshot`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), JPEG);
  }
  assert.equal(cameraRequests, 4); // 1 desafio + 1 autenticada + 2 reaproveitando o nonce
});

test('senha errada vira 401 e a API pública não vaza senhas', async () => {
  await call('/api/settings', 'PUT', { refreshDelayMs: 1000, auth: { username: USER, password: 'errada' } });
  const [cam] = (await (await call('/api/config')).json()).cameras;
  const res = await call(`/api/cameras/${cam.id}/snapshot`);
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /inválidos/);

  const text = await (await call('/api/config')).text();
  assert.equal(text.includes('errada'), false);
});

test('senha recusada: a câmera é consultada uma vez e depois fica em pausa (anti-bloqueio)', async () => {
  const pausedPanel = createServer({ configPath: join(dir, 'paused.json'), timeoutMs: 1000 });
  const p = await listen(pausedPanel);
  const url = (path) => `http://127.0.0.1:${p}${path}`;
  let session;
  const send = (path, method = 'GET', body, { anonymous = false } = {}) => fetch(url(path), {
    method,
    headers: { ...(body && { 'Content-Type': 'application/json' }), ...(session && !anonymous && { Cookie: session }) },
    body: body && JSON.stringify(body),
  });
  try {
    session = await login(`http://127.0.0.1:${p}`);
    await send('/api/settings', 'PUT', { refreshDelayMs: 1000, auth: { username: USER, password: 'errada' } });
    const { id } = await (await send('/api/cameras', 'POST', { name: 'Trava', ip: camAddress })).json();

    cameraRequests = 0;
    const first = await send(`/api/cameras/${id}/snapshot`);
    assert.equal(first.status, 401);
    const afterFirst = cameraRequests; // 1 desafio + 1 tentativa com a senha errada

    for (let i = 0; i < 5; i++) {
      const res = await send(`/api/cameras/${id}/snapshot`);
      assert.equal(res.status, 401);
      assert.match((await res.json()).error, /pausadas/);
    }
    assert.equal(cameraRequests, afterFirst); // as 5 seguintes nem chegaram na câmera

    // Corrigir a senha no painel libera na hora.
    await send('/api/settings', 'PUT', { refreshDelayMs: 1000, auth: { username: USER, password: PASS } });
    assert.equal((await send(`/api/cameras/${id}/snapshot`)).status, 200);

    // "Testar" (force=1) tenta mesmo durante a pausa; sem force, nada chega à câmera.
    await send('/api/settings', 'PUT', { refreshDelayMs: 1000, auth: { username: USER, password: 'errada-de-novo' } });
    assert.equal((await send(`/api/cameras/${id}/snapshot`)).status, 401); // entra em pausa
    cameraRequests = 0;
    assert.equal((await send(`/api/cameras/${id}/snapshot`)).status, 401);
    assert.equal(cameraRequests, 0);
    // Sem login o force é ignorado: ninguém de fora consegue insistir e bloquear a câmera.
    assert.equal((await send(`/api/cameras/${id}/snapshot?force=1`, 'GET', undefined, { anonymous: true })).status, 401);
    assert.equal(cameraRequests, 0);
    assert.equal((await send(`/api/cameras/${id}/snapshot?force=1`)).status, 401);
    assert.ok(cameraRequests > 0); // o teste manual (logado) realmente foi até a câmera
  } finally {
    pausedPanel.close();
  }
});

test('câmera offline vira erro 502 e rotas desconhecidas 404', async () => {
  const { id } = await (await call('/api/cameras', 'POST', { name: 'Off', ip: '127.0.0.1:9' })).json();
  assert.equal((await call(`/api/cameras/${id}/snapshot`)).status, 502);
  assert.equal((await call('/api/nada')).status, 404);
  assert.equal((await call('/api/cameras/xxxx/snapshot')).status, 404);
});

test('escrita exige JSON (proteção contra CSRF por formulário)', async () => {
  const res = await fetch(`${base}/api/settings`, {
    method: 'PUT', headers: { 'Content-Type': 'text/plain', Cookie: cookie }, body: '{}',
  });
  assert.equal(res.status, 415);
});

test('serve a interface e bloqueia path traversal', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Painel de Câmeras/);
  const res = await fetch(`${base}/..%2fpackage.json`);
  assert.notEqual(res.status, 200);
});
