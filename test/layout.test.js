import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, deviceLayout, parseQuery, toSaved, toggleFeatured, withLayout } from '../public/layout.js';

const cams = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, name: `Cam ${i + 1}` }));

test('parseQuery: sem nada na URL vale o padrão do aparelho e depois a preferência salva', () => {
  assert.deepEqual(parseQuery(''), { layout: 'equal', per: 'auto', fit: 'contain', focusIds: [], page: 1 });
  assert.equal(parseQuery('', null, 'focus1').layout, 'focus1'); // celular
  const saved = { layout: 'focus2', per: 6, fit: 'cover', focusIds: ['c3', 'c1'] };
  assert.deepEqual(parseQuery('', saved), { layout: 'focus2', per: 6, fit: 'cover', focusIds: ['c3', 'c1'], page: 1 });
  assert.deepEqual(parseQuery('?page=2', saved), { ...saved, page: 2 });
});

test('parseQuery: a URL vence a preferência, parte por parte', () => {
  const saved = { layout: 'focus2', per: 6, fit: 'cover', focusIds: ['c3'] };
  assert.deepEqual(parseQuery('?layout=equal&per=all', saved),
    { layout: 'equal', per: 'all', fit: 'contain', focusIds: [], page: 1 }); // link explícito não herda foco nem ajuste
  assert.deepEqual(parseQuery('?layout=focus1&per=4&focus=c2&fit=cover&page=3', saved),
    { layout: 'focus1', per: 4, fit: 'cover', focusIds: ['c2'], page: 3 });
  assert.equal(parseQuery('?layout=focus1', saved).per, 6); // per ausente na URL: usa o salvo
});

test('parseQuery: valores inválidos caem no padrão', () => {
  assert.deepEqual(parseQuery('?layout=xyz&per=-3&fit=abc&page=0'), { layout: 'equal', per: 'auto', fit: 'contain', focusIds: [], page: 1 });
  assert.equal(parseQuery('?per=999').per, 'auto');
  assert.equal(parseQuery('?per=7.5').per, 'auto');
  assert.deepEqual(parseQuery('?focus=a,,b, c ').focusIds, ['a', 'b', 'c']);
});

test('parseQuery: links antigos (?grid=N) continuam funcionando', () => {
  assert.deepEqual(parseQuery('?grid=3'), { layout: 'equal', per: 9, fit: 'contain', focusIds: [], page: 1 });
  assert.deepEqual(parseQuery('?grid=2&page=2'), { layout: 'equal', per: 4, fit: 'contain', focusIds: [], page: 2 });
  assert.deepEqual(parseQuery('?grid=1'), { layout: 'equal', per: 1, fit: 'contain', focusIds: [], page: 1 });
  // antes, no 3x3 o foco ocupava 2x2 (1 destaque + 5 outras) e no 4x4 ocupava 3x3 (1 + 7)
  assert.deepEqual(parseQuery('?grid=3&focus=c2'), { layout: 'focus1', per: 6, fit: 'contain', focusIds: ['c2'], page: 1 });
  assert.deepEqual(parseQuery('?grid=4&focus=c2'), { layout: 'focus1', per: 8, fit: 'contain', focusIds: ['c2'], page: 1 });
  assert.equal(parseQuery('?grid=2&focus=c2').layout, 'equal'); // 2x2 nunca teve foco
});

test('buildQuery: só leva o que importa', () => {
  assert.equal(buildQuery({ layout: 'equal', per: 'auto', fit: 'contain', focusIds: ['c1'], page: 1 }), '?layout=equal&per=auto');
  assert.equal(buildQuery({ layout: 'focus1', per: 6, fit: 'cover', focusIds: ['c2', 'c3'], page: 2 }), '?layout=focus1&per=6&fit=cover&focus=c2&page=2');
  assert.equal(buildQuery({ layout: 'focus2', per: 'all', fit: 'contain', focusIds: ['c2', 'c3', 'c4'], page: 1 }), '?layout=focus2&per=all&focus=c2%2Cc3');
  // ida e volta
  const state = { layout: 'focus2', per: 9, fit: 'cover', focusIds: ['c4', 'c2'], page: 3 };
  assert.deepEqual(parseQuery(buildQuery(state)), state);
});

test('toSaved guarda a escolha, sem a página', () => {
  assert.deepEqual(toSaved({ layout: 'focus1', per: 4, fit: 'cover', focusIds: ['c1'], page: 5 }),
    { layout: 'focus1', per: 4, fit: 'cover', focusIds: ['c1'] });
});

test('celular começa com 1 destaque; o resto, com tiles iguais', () => {
  assert.equal(deviceLayout(390), 'focus1');
  assert.equal(deviceLayout(700), 'focus1');
  assert.equal(deviceLayout(701), 'equal');
});

test('destacar: sem destaque vira 1; 1 troca; 2 entra no lugar da mais antiga; clicar de novo tira', () => {
  const cameras = cams(5);
  const base = { layout: 'equal', per: 'auto', fit: 'contain', focusIds: [], page: 3 };

  let s = toggleFeatured(base, cameras, 'c3');
  assert.deepEqual([s.layout, s.focusIds, s.page], ['focus1', ['c3'], 1]); // volta para a página 1

  s = toggleFeatured(s, cameras, 'c5'); // 1 destaque: troca
  assert.deepEqual([s.layout, s.focusIds], ['focus1', ['c5']]);

  s = toggleFeatured({ ...s, layout: 'focus2', focusIds: ['c5', 'c2'] }, cameras, 'c4'); // 2 destaques: sai a mais antiga
  assert.deepEqual([s.layout, s.focusIds], ['focus2', ['c2', 'c4']]);

  s = toggleFeatured(s, cameras, 'c2'); // tira um dos dois
  assert.deepEqual([s.layout, s.focusIds], ['focus1', ['c4']]);
  s = toggleFeatured(s, cameras, 'c4'); // tira o último: volta a "Iguais"
  assert.deepEqual([s.layout, s.focusIds], ['equal', []]);

  // destaque "implícito" (a primeira câmera) também pode ser retirado
  s = toggleFeatured({ ...base, layout: 'focus1', focusIds: [] }, cameras, 'c1');
  assert.equal(s.layout, 'equal');
});

test('trocar de layout mantém os destaques que existiam', () => {
  const cameras = cams(5);
  const state = { layout: 'focus2', per: 'auto', fit: 'contain', focusIds: ['c4', 'c2'], page: 2 };
  assert.deepEqual(withLayout(state, cameras, 'focus1').focusIds, ['c4']);
  assert.deepEqual(withLayout(state, cameras, 'equal').focusIds, []);
  assert.deepEqual(withLayout({ ...state, layout: 'focus1', focusIds: ['c4'] }, cameras, 'focus2').focusIds, ['c4']); // o resto completa na hora de desenhar
  assert.equal(withLayout(state, cameras, 'focus1').page, 1);
});
