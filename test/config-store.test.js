import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigStore } from '../src/config-store.js';

function tmpStore() {
  const dir = mkdtempSync(join(tmpdir(), 'cams-'));
  const file = join(dir, 'nested', 'config.json');
  return { file, store: createConfigStore(file), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('cadastra, persiste em JSON e nunca expõe senhas', () => {
  const { file, store, cleanup } = tmpStore();
  try {
    store.updateSettings({ refreshDelayMs: 1500, auth: { username: 'u', password: 'secret' } });
    const id = store.addCamera({ name: 'Porta', ip: '10.0.0.5', username: 'x', password: 'y' });

    const view = store.getPublic();
    assert.equal(view.refreshDelayMs, 1500);
    assert.equal(JSON.stringify(view).includes('secret'), false);
    assert.equal(view.cameras[0].hasPassword, true);

    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.cameras[0].ip, '10.0.0.5');
    assert.equal(saved.cameras[0].id, id);
    assert.deepEqual(createConfigStore(file).getPublic(), view); // recarrega igual
  } finally { cleanup(); }
});

test('credenciais individuais têm prioridade sobre as globais', () => {
  const { store, cleanup } = tmpStore();
  try {
    store.updateSettings({ refreshDelayMs: 1000, auth: { username: 'global', password: 'g' } });
    const own = store.getCamera(store.addCamera({ name: 'A', ip: '10.0.0.1', username: 'own', password: 'o' }));
    const shared = store.getCamera(store.addCamera({ name: 'B', ip: '10.0.0.2' }));
    assert.deepEqual(store.credentialsFor(own), { username: 'own', password: 'o' });
    assert.deepEqual(store.credentialsFor(shared), { username: 'global', password: 'g' });
  } finally { cleanup(); }
});

test('editar sem senha mantém a senha atual', () => {
  const { store, cleanup } = tmpStore();
  try {
    const id = store.addCamera({ name: 'A', ip: '10.0.0.1', username: 'u', password: 'keep' });
    store.updateCamera(id, { name: 'Renomeada', ip: '10.0.0.1', username: 'u', password: '' });
    assert.equal(store.getCamera(id).password, 'keep');
    assert.equal(store.getCamera(id).name, 'Renomeada');
  } finally { cleanup(); }
});

test('delay da câmera é opcional e sobrescreve o global', () => {
  const { file, store, cleanup } = tmpStore();
  try {
    store.updateSettings({ refreshDelayMs: 1000, auth: {} });
    const own = store.addCamera({ name: 'A', ip: '10.0.0.1', refreshDelayMs: '250' }); // string vinda do formulário
    const shared = store.addCamera({ name: 'B', ip: '10.0.0.2', refreshDelayMs: '' });

    const byId = Object.fromEntries(store.getPublic().cameras.map((c) => [c.id, c.refreshDelayMs]));
    assert.equal(byId[own], 250);
    assert.equal(byId[shared], null);
    assert.equal(createConfigStore(file).getPublic().cameras[0].refreshDelayMs, 250); // persiste

    store.updateCamera(own, { name: 'A', ip: '10.0.0.1', refreshDelayMs: null }); // limpar volta ao global
    assert.equal(store.getCamera(own).refreshDelayMs, null);

    assert.throws(() => store.addCamera({ name: 'x', ip: '10.0.0.3', refreshDelayMs: 5 }), /delay/);
    assert.throws(() => store.addCamera({ name: 'x', ip: '10.0.0.3', refreshDelayMs: 'abc' }), /delay/);
  } finally { cleanup(); }
});

test('valida IP, delay e reordenação; exclui câmeras', () => {
  const { store, cleanup } = tmpStore();
  try {
    assert.throws(() => store.addCamera({ name: 'x', ip: 'evil.com/path?x=' }), /IP inválido/);
    assert.throws(() => store.addCamera({ name: 'x', ip: '' }), /IP inválido/);
    assert.throws(() => store.updateSettings({ refreshDelayMs: 5, auth: {} }), /delay/);

    const a = store.addCamera({ name: 'A', ip: '10.0.0.1:8080' });
    const b = store.addCamera({ name: 'B', ip: 'cam.local' });
    store.reorder([b, a]);
    assert.deepEqual(store.getPublic().cameras.map((c) => c.id), [b, a]);
    assert.throws(() => store.reorder([a]), /inválida/);

    store.removeCamera(a);
    assert.equal(store.getPublic().cameras.length, 1);
    assert.throws(() => store.removeCamera(a), /não encontrada/);
  } finally { cleanup(); }
});
