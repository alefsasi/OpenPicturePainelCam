import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLoginLimiter, createSessions, hashPassword, parseCookies, verifyPassword } from '../src/auth.js';
import { createServer } from '../src/server.js';
import { login } from '../test-support/login.js';

test('hash scrypt: confere a senha certa, recusa a errada e nunca repete o hash', async () => {
  const hash = await hashPassword('minha-senha');
  assert.match(hash, /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.equal(hash.includes('minha-senha'), false);
  assert.equal(await verifyPassword('minha-senha', hash), true);
  assert.equal(await verifyPassword('outra', hash), false);
  assert.equal(await verifyPassword('minha-senha', 'lixo'), false);
  assert.notEqual(await hashPassword('minha-senha'), hash); // sal diferente a cada vez
});

test('sessões: expiram, podem ser derrubadas e têm teto', () => {
  const sessions = createSessions({ ttlMs: 30, max: 2 });
  const a = sessions.create();
  const b = sessions.create();
  assert.ok(sessions.isValid(a) && sessions.isValid(b));
  sessions.create(); // passou do teto: a mais antiga sai
  assert.equal(sessions.isValid(a), false);

  const keep = sessions.create();
  sessions.destroyAllExcept(keep);
  assert.equal(sessions.isValid(b), false);
  assert.equal(sessions.isValid(keep), true);

  assert.equal(sessions.isValid(undefined), false);
  return new Promise((resolve) => setTimeout(() => { assert.equal(sessions.isValid(keep), false); resolve(); }, 60));
});

test('limitador: bloqueia depois de N falhas e libera com o sucesso/tempo', async () => {
  const limiter = createLoginLimiter({ maxFailures: 3, lockMs: 40 });
  limiter.fail('ip'); limiter.fail('ip');
  assert.equal(limiter.retryAfter('ip'), 0);
  limiter.fail('ip');
  assert.ok(limiter.retryAfter('ip') > 0);
  assert.equal(limiter.retryAfter('outro-ip'), 0); // por endereço
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(limiter.retryAfter('ip'), 0);

  limiter.fail('x'); limiter.success('x'); limiter.fail('x'); limiter.fail('x');
  assert.equal(limiter.retryAfter('x'), 0); // o sucesso zerou a contagem
});

test('parseCookies', () => {
  assert.deepEqual(parseCookies('a=1; painel_session=abc; b=x=y'), { a: '1', painel_session: 'abc', b: 'x=y' });
  assert.deepEqual(parseCookies(undefined), {});
});

async function startPanel(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cams-auth-'));
  const configPath = join(dir, 'config.json');
  const server = createServer({ configPath, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = 'GET', body, cookie } = {}) => fetch(base + path, {
    method,
    headers: { ...(body && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
    body: body && JSON.stringify(body),
  });
  return { base, call, configPath, close: () => { server.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('sem login: assistir é livre, alterar e configurar não, e o IP das câmeras não aparece', async () => {
  const panel = await startPanel();
  try {
    const cookie = await login(panel.base);
    const created = await panel.call('/api/cameras', { method: 'POST', cookie, body: { name: 'Porta', ip: '10.1.2.3', username: 'u', password: 'secreta' } });
    const { id } = await created.json();

    const anon = await (await panel.call('/api/config')).json();
    assert.deepEqual(anon.cameras, [{ id, name: 'Porta', refreshDelayMs: null, streamMode: null }]);
    const raw = JSON.stringify(anon);
    for (const leak of ['10.1.2.3', 'secreta', '"username"', 'rtspPort']) assert.equal(raw.includes(leak), false, `vazou ${leak}`);

    const logged = await (await panel.call('/api/config', { cookie })).json();
    assert.equal(logged.cameras[0].ip, '10.1.2.3'); // logado vê tudo (senhas continuam mascaradas)
    assert.equal(JSON.stringify(logged).includes('secreta'), false);

    const body = { refreshDelayMs: 1000, auth: {} };
    for (const [path, method, data] of [
      ['/api/settings', 'PUT', body],
      ['/api/cameras', 'POST', { name: 'x', ip: '10.0.0.1' }],
      [`/api/cameras/${id}`, 'PUT', { name: 'x', ip: '10.0.0.1' }],
      [`/api/cameras/${id}`, 'DELETE', undefined],
      ['/api/cameras/order', 'PUT', { ids: [id] }],
      ['/api/password', 'PUT', { current: 'admin', next: 'nova-senha' }],
    ]) {
      const res = await panel.call(path, { method, body: data });
      assert.equal(res.status, 401, `${method} ${path} deveria exigir login`);
    }
    assert.equal((await panel.call('/api/session')).status, 200); // consultar a sessão é livre
  } finally { panel.close(); }
});

test('login: senha padrão "admin", cookie HttpOnly/SameSite, sessão e logout', async () => {
  const panel = await startPanel();
  try {
    assert.deepEqual(await (await panel.call('/api/session')).json(), { authenticated: false });

    const wrong = await panel.call('/api/login', { method: 'POST', body: { password: 'errada' } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get('set-cookie'), null);

    const ok = await panel.call('/api/login', { method: 'POST', body: { password: 'admin' } });
    assert.equal(ok.status, 200);
    const setCookie = ok.headers.get('set-cookie');
    assert.match(setCookie, /^painel_session=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+$/);
    const cookie = setCookie.split(';')[0];

    assert.deepEqual(await (await panel.call('/api/session', { cookie })).json(), { authenticated: true, usingDefaultPassword: true });

    await panel.call('/api/logout', { method: 'POST', body: {}, cookie });
    assert.deepEqual(await (await panel.call('/api/session', { cookie })).json(), { authenticated: false });
  } finally { panel.close(); }
});

test('limite de tentativas: depois de várias senhas erradas devolve 429, até com a senha certa', async () => {
  const panel = await startPanel({ authOptions: { limiter: { maxFailures: 3, lockMs: 5000 } } });
  try {
    for (let i = 0; i < 3; i++) {
      assert.equal((await panel.call('/api/login', { method: 'POST', body: { password: 'x' } })).status, 401);
    }
    const blocked = await panel.call('/api/login', { method: 'POST', body: { password: 'admin' } });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  } finally { panel.close(); }
});

test('trocar a senha: exige a atual, grava só o hash, derruba outras sessões e vale no próximo login', async () => {
  const panel = await startPanel();
  try {
    const mine = await login(panel.base);
    const other = await login(panel.base);

    const bad = (body) => panel.call('/api/password', { method: 'PUT', cookie: mine, body });
    assert.equal((await bad({ current: 'errada', next: 'senha-nova-1' })).status, 403);
    assert.equal((await bad({ current: 'admin', next: 'curta' })).status, 400);
    assert.equal((await bad({ current: 'admin', next: 'admin' })).status, 400);

    assert.equal((await bad({ current: 'admin', next: 'senha-nova-1' })).status, 200);
    const saved = readFileSync(panel.configPath, 'utf8');
    assert.equal(saved.includes('senha-nova-1'), false); // nunca em texto puro
    assert.match(saved, /"passwordHash": "scrypt:/);

    assert.equal((await (await panel.call('/api/session', { cookie: mine })).json()).authenticated, true);
    assert.equal((await (await panel.call('/api/session', { cookie: mine })).json()).usingDefaultPassword, false);
    assert.equal((await (await panel.call('/api/session', { cookie: other })).json()).authenticated, false);

    assert.equal((await panel.call('/api/login', { method: 'POST', body: { password: 'admin' } })).status, 401);
    assert.equal((await panel.call('/api/login', { method: 'POST', body: { password: 'senha-nova-1' } })).status, 200);
  } finally { panel.close(); }
});

test('redefinir senha pela CLI: só do próprio computador e citando o PID; volta para "admin"', async () => {
  const panel = await startPanel();
  try {
    const cookie = await login(panel.base);
    await panel.call('/api/password', { method: 'PUT', cookie, body: { current: 'admin', next: 'outra-senha-2' } });
    assert.equal((await panel.call('/api/login', { method: 'POST', body: { password: 'admin' } })).status, 401);

    assert.equal((await panel.call('/api/reset-password', { method: 'POST', body: { pid: process.pid + 1 } })).status, 400);
    assert.equal((await panel.call('/api/reset-password', { method: 'POST', body: { pid: process.pid } })).status, 200);

    assert.equal((await panel.call('/api/login', { method: 'POST', body: { password: 'admin' } })).status, 200);
    assert.equal((await (await panel.call('/api/session', { cookie })).json()).authenticated, false); // sessões antigas caíram
  } finally { panel.close(); }
});

test('o login exige JSON (formulário de outro site não consegue)', async () => {
  const panel = await startPanel();
  try {
    const res = await fetch(`${panel.base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=admin',
    });
    assert.equal(res.status, 415);
  } finally { panel.close(); }
});
