import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, computeView, focusSpan, parseQuery } from '../public/layout.js';

const cams = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, name: `Cam ${i + 1}` }));
const ids = (view) => view.items.map((c) => c.id);

test('parseQuery: valores inválidos caem no padrão', () => {
  assert.deepEqual(parseQuery(''), { grid: 2, focusId: null, page: 1 });
  assert.deepEqual(parseQuery('?grid=7&page=-3'), { grid: 2, focusId: null, page: 1 });
  assert.deepEqual(parseQuery('?grid=4&page=2&focus=c9'), { grid: 4, focusId: 'c9', page: 2 });
});

test('parseQuery: sem grid na URL vale a visualização padrão salva; com grid, a URL vence', () => {
  const cams = [{ id: 'c1' }, { id: 'c2' }];
  assert.deepEqual(parseQuery('', { grid: 4, focus: false }, cams), { grid: 4, focusId: null, page: 1 });
  // padrão com foco: a primeira câmera da lista fica em destaque
  assert.deepEqual(parseQuery('', { grid: 3, focus: true }, cams), { grid: 3, focusId: 'c1', page: 1 });
  assert.deepEqual(parseQuery('?page=2', { grid: 3, focus: true }, cams), { grid: 3, focusId: 'c1', page: 2 });
  // a URL explícita não herda o foco do padrão
  assert.deepEqual(parseQuery('?grid=3', { grid: 4, focus: true }, cams), { grid: 3, focusId: null, page: 1 });
  assert.deepEqual(parseQuery('?grid=2', { grid: 3, focus: true }, cams), { grid: 2, focusId: null, page: 1 });
  // sem câmeras não há foco
  assert.equal(parseQuery('', { grid: 3, focus: true }, []).focusId, null);
});

test('grid 2x2 com 9 câmeras mostra só 4 e pagina', () => {
  const all = cams(9);
  assert.deepEqual(ids(computeView({ grid: 2, page: 1 }, all)), ['c1', 'c2', 'c3', 'c4']);
  const last = computeView({ grid: 2, page: 3 }, all);
  assert.deepEqual(ids(last), ['c9']);
  assert.equal(last.pages, 3);
});

test('página fora do intervalo é ajustada', () => {
  assert.equal(computeView({ grid: 2, page: 99 }, cams(9)).page, 3);
  assert.equal(computeView({ grid: 3, page: 5 }, []).pages, 1);
});

test('foco 3x3: câmera em foco ocupa 4 posições + 5 outras por página', () => {
  assert.equal(focusSpan(3), 2);
  const view = computeView({ grid: 3, focusId: 'c4', page: 1 }, cams(12));
  assert.equal(view.focus.id, 'c4');
  assert.deepEqual(ids(view), ['c4', 'c1', 'c2', 'c3', 'c5', 'c6']);
  assert.equal(view.pages, 3); // 11 outras / 5
  assert.deepEqual(ids(computeView({ grid: 3, focusId: 'c4', page: 3 }, cams(12))), ['c4', 'c12']);
});

test('foco 4x4: câmera em foco ocupa 9 posições + 7 outras por página', () => {
  assert.equal(focusSpan(4), 3);
  const view = computeView({ grid: 4, focusId: 'c1', page: 1 }, cams(20));
  assert.equal(view.items.length, 8);
  assert.equal(view.pages, 3); // 19 outras / 7
});

test('foco inexistente ou em grid sem foco é ignorado', () => {
  assert.equal(computeView({ grid: 3, focusId: 'nope', page: 1 }, cams(10)).focus, null);
  assert.equal(computeView({ grid: 2, focusId: 'c1', page: 1 }, cams(10)).focus, null);
});

test('buildQuery respeita grid, foco e página', () => {
  assert.equal(buildQuery({ grid: 3, focusId: 'c2', page: 2 }), '?grid=3&focus=c2&page=2');
  assert.equal(buildQuery({ grid: 2, focusId: 'c2', page: 1 }), '?grid=2');
});
