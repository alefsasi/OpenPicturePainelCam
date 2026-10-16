import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemdUnit, windowsCommand } from '../src/autostart.js';
import { createConfigStore } from '../src/config-store.js';
import { baseUrl, parseEnvFile } from '../src/runtime.js';
import { createServer } from '../src/server.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('parseEnvFile: comentários, aspas e linhas inválidas', () => {
  const values = parseEnvFile('# config\nPORT=8080\r\nHOST = "0.0.0.0"\nFFMPEG_PATH=\'C:\\ff mpeg\\ffmpeg.exe\'\n\nlixo sem igual\n=sem-chave\n');
  assert.deepEqual(values, { PORT: '8080', HOST: '0.0.0.0', FFMPEG_PATH: 'C:\\ff mpeg\\ffmpeg.exe' });
});

test('baseUrl: 0.0.0.0 e :: viram loopback; IPv6 ganha colchetes', () => {
  assert.equal(baseUrl({ host: '0.0.0.0', port: 7391 }), 'http://127.0.0.1:7391');
  assert.equal(baseUrl({ host: '::', port: 1 }), 'http://127.0.0.1:1');
  assert.equal(baseUrl({ host: '::1', port: 2 }), 'http://[::1]:2');
  assert.equal(baseUrl({ host: '192.168.0.5', port: 3 }), 'http://192.168.0.5:3');
});

test('início automático: comando do Windows e unidade systemd', () => {
  assert.equal(windowsCommand('C:\\Program Files\\nodejs\\node.exe', 'D:\\app\\src\\cli.js'),
    '"C:\\Program Files\\nodejs\\node.exe" "D:\\app\\src\\cli.js" start --quiet');

  const unit = systemdUnit('/opt/painel/runtime/node', '/opt/painel/src/index.js', '/opt/painel');
  assert.match(unit, /^ExecStart=\/opt\/painel\/runtime\/node \/opt\/painel\/src\/index\.js$/m);
  assert.match(unit, /^WorkingDirectory=\/opt\/painel$/m);
  assert.match(unit, /^Restart=on-failure$/m); // "stop" (saída 0) não reinicia, queda sim
  assert.match(unit, /^WantedBy=default\.target$/m);
  assert.throws(() => systemdUnit('/opt/meu painel/node', '/opt/painel/src/index.js', '/opt/painel'), /espaço/);
});

test('API de parada: só com JSON e PID certo; chama onShutdown depois de responder', async () => {
  let stopped = 0;
  const dir = mkdtempSync(join(tmpdir(), 'cams-stop-'));
  const server = createServer({ configPath: join(dir, 'config.json'), onShutdown: () => { stopped++; } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, type = 'application/json') => fetch(`${base}/api/shutdown`, { method: 'POST', headers: { 'Content-Type': type }, body });
  try {
    const ping = await (await fetch(`${base}/api/ping`)).json();
    assert.deepEqual(ping, { app: 'open-picture-painel-cam', pid: process.pid });

    assert.equal((await post('{}', 'text/plain')).status, 415); // formulário de outro site não passa
    assert.equal((await post(JSON.stringify({ pid: process.pid + 1 }))).status, 400);
    assert.equal(stopped, 0);

    assert.equal((await post(JSON.stringify({ pid: process.pid }))).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(stopped, 1);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sem onShutdown (uso como biblioteca) a rota de parada não existe', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cams-nostop-'));
  const server = createServer({ configPath: join(dir, 'config.json') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/shutdown`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(res.status, 404);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function freePort() {
  const probe = createNetServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test('CLI: start em segundo plano, status, start repetido, stop e limpeza do PID', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cams-cli-'));
  const env = { ...process.env, CONFIG_PATH: join(dir, 'config.json'), PORT: String(await freePort()), HOST: '127.0.0.1' };
  const cli = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', timeout: 20_000 });
  try {
    assert.match(cli('start'), /rodando em segundo plano/);
    assert.ok(existsSync(join(dir, 'painel.pid')));
    assert.match(readFileSync(join(dir, 'painel.log'), 'utf8'), /Painel de câmeras em/);

    assert.match(cli('status'), /Rodando: http:\/\/127\.0\.0\.1:\d+ \(PID \d+/);
    assert.match(cli('start'), /Já está rodando/);

    assert.match(cli('stop'), /Painel parado/);
    assert.equal(existsSync(join(dir, 'painel.pid')), false);
    assert.match(cli('stop'), /não está rodando/);
  } finally {
    try { cli('stop', '--force'); } catch { /* já parado */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI reset-password (painel parado): volta a senha das configurações para "admin"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cams-reset-'));
  const configPath = join(dir, 'config.json');
  try {
    const store = createConfigStore(configPath);
    await store.setPassword('outra-senha-9');
    assert.equal(await store.checkPassword('admin'), false);

    const out = execFileSync(process.execPath, [CLI, 'reset-password'], {
      env: { ...process.env, CONFIG_PATH: configPath, PORT: String(await freePort()) }, encoding: 'utf8',
    });
    assert.match(out, /redefinida para a padrão/);

    const reloaded = createConfigStore(configPath);
    assert.equal(await reloaded.checkPassword('admin'), true);
    assert.equal(await reloaded.checkPassword('outra-senha-9'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: comando desconhecido falha com código 1', () => {
  assert.throws(() => execFileSync(process.execPath, [CLI, 'voar'], { stdio: 'pipe' }), (err) => err.status === 1);
});
