import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPACT_W, RATIO, computeView, fillGrid, fitGrid, resolveFeatured } from '../public/packing.js';

const cams = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, name: `Cam ${i + 1}` }));

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const coverage = (rects, w, h) => rects.reduce((sum, r) => sum + r.w * r.h, 0) / (w * h);

function assertNoOverlap(rects, label) {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) assert.equal(overlaps(rects[i], rects[j]), false, `${label}: tiles ${i} e ${j} se sobrepõem`);
  }
}

test('fitGrid: tiles 16:9 exatos, dentro da área, sem sobrepor e centralizados', () => {
  for (const [w, h] of [[1920, 950], [1366, 650], [800, 800], [390, 300]]) {
    for (let n = 1; n <= 16; n++) {
      const { rects, tileW, tileH } = fitGrid(n, w, h, 4);
      assert.equal(rects.length, n);
      assertNoOverlap(rects, `${w}x${h} n=${n}`);
      for (const r of rects) {
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h, `${w}x${h} n=${n}: fora da área`);
        assert.ok(Math.abs(r.w / r.h - RATIO) < 0.03, `${w}x${h} n=${n}: não é 16:9 (${r.w}x${r.h})`);
      }
      assert.ok(tileW > 0 && tileH > 0);
    }
  }
});

test('fitGrid escolhe as colunas que deixam o tile maior', () => {
  // 4 câmeras numa tela larga: 2x2 (tile 838 de largura) ganha de 4x1 (471) e de 1x4.
  assert.equal(fitGrid(4, 1920, 950, 4).cols, 2);
  // 1 câmera ocupa o máximo possível
  assert.equal(fitGrid(1, 1600, 900, 0).tileW, 1600);
  assert.equal(fitGrid(1, 1000, 900, 0).tileW, 1000);
  assert.equal(fitGrid(0, 100, 100).rects.length, 0);
});

test('fitGrid: a última fila incompleta fica centralizada', () => {
  const { rects } = fitGrid(5, 1000, 600, 0); // 3 + 2
  const lastRow = rects.filter((r) => r.y === rects[3].y);
  assert.equal(lastRow.length, 2);
  const left = lastRow[0].x;
  const right = 1000 - (lastRow[1].x + lastRow[1].w);
  assert.ok(Math.abs(left - right) <= 1, `sobras desiguais: ${left} / ${right}`);
});

test('fillGrid cobre a área inteira, sem buracos nem sobreposição', () => {
  for (const [w, h, gap] of [[1920, 950, 4], [1024, 680, 4], [844, 330, 4], [700, 700, 0]]) {
    for (let n = 1; n <= 16; n++) {
      const { rects } = fillGrid(n, w, h, gap);
      assert.equal(rects.length, n);
      assertNoOverlap(rects, `${w}x${h} n=${n}`);
      assert.equal(Math.min(...rects.map((r) => r.x)), 0);
      assert.equal(Math.min(...rects.map((r) => r.y)), 0);
      assert.equal(Math.max(...rects.map((r) => r.x + r.w)), w, `${w}x${h} n=${n}: não chega na borda direita`);
      assert.equal(Math.max(...rects.map((r) => r.y + r.h)), h, `${w}x${h} n=${n}: não chega na borda de baixo`);
      // só sobra o espaço dos vãos de 4 px entre tiles (em 16 tiles numa tela baixa chega a ~5%)
      assert.ok(coverage(rects, w, h) >= 0.93, `${w}x${h} n=${n}: cobertura ${coverage(rects, w, h)}`);
    }
  }
});

const SCREENS = [
  [1920, 950], [1366, 650], [1024, 680], [768, 900], [390, 640], [844, 330], [320, 480], [2560, 1300],
];

test('computeView: cada câmera aparece uma vez, os destaques em todas as páginas, nada sai da tela nem se sobrepõe', () => {
  for (const [width, height] of SCREENS) {
    for (const layout of ['equal', 'focus1', 'focus2']) {
      for (const fit of ['contain', 'cover']) {
        for (const per of ['auto', 'all', 4, 9]) {
          for (const n of [1, 2, 3, 5, 6, 9, 16, 23]) {
            const label = `${width}x${height} ${layout} ${fit} per=${per} n=${n}`;
            const cameras = cams(n);
            const seen = new Map();
            let pages = 1;
            for (let page = 1; page <= pages; page++) {
              const view = computeView({ cameras, layout, per, fit, page, width, height, gap: 4 });
              pages = view.pages;
              assert.equal(view.page, page, label);
              assertNoOverlap(view.items.map((i) => i.rect), label);
              for (const { rect, camera, featured } of view.items) {
                assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= width && rect.y + rect.h <= view.contentHeight, `${label}: ${camera.id} fora da área`);
                if (fit === 'contain') assert.ok(Math.abs(rect.w / rect.h - RATIO) < 0.04, `${label}: ${camera.id} ${rect.w}x${rect.h} não é 16:9`);
                seen.set(camera.id, (seen.get(camera.id) ?? 0) + (featured ? 0 : 1) + (featured && page === 1 ? 1 : 0));
              }
              const featuredIds = view.items.filter((i) => i.featured).map((i) => i.camera.id);
              assert.deepEqual(featuredIds, resolveFeatured(cameras, layout).map((c) => c.id), `${label}: destaques mudaram de página`);
            }
            assert.equal(seen.size, n, `${label}: faltou câmera`);
            for (const [id, count] of seen) assert.equal(count, 1, `${label}: ${id} apareceu ${count}x`);
          }
        }
      }
    }
  }
});

test('"Preencher" (cover) cobre quase toda a tela deitada em qualquer layout', () => {
  for (const [width, height] of [[1920, 950], [1366, 650], [1024, 680], [844, 330], [2560, 1300]]) {
    for (const layout of ['equal', 'focus1', 'focus2']) {
      for (const n of [1, 2, 3, 5, 6, 9, 16]) {
        const view = computeView({ cameras: cams(n), layout, per: 'all', fit: 'cover', width, height, gap: 4 });
        const c = coverage(view.items.map((i) => i.rect), width, height);
        assert.ok(c >= 0.93, `${width}x${height} ${layout} n=${n}: cobertura ${c.toFixed(3)}`); // só os vãos de 4px sobram
      }
    }
  }
});

test('"Inteira" (contain) aproveita bem a tela quando há destaque (marcas medidas)', () => {
  const at = (layout, n, w, h) => coverage(
    computeView({ cameras: cams(n), layout, per: 'all', width: w, height: h, gap: 4 }).items.map((i) => i.rect), w, h);
  assert.ok(at('focus1', 6, 1366, 650) >= 0.9);
  assert.ok(at('focus1', 5, 1920, 950) >= 0.88);
  assert.ok(at('focus2', 5, 1920, 950) >= 0.88);
  assert.ok(at('equal', 9, 1920, 950) >= 0.8);
  assert.ok(at('equal', 16, 1920, 950) >= 0.8);
});

test('destaque é claramente maior que as outras (pelo menos 1,6x em área)', () => {
  for (const [width, height] of [[1920, 950], [1366, 650], [1024, 680]]) {
    for (const layout of ['focus1', 'focus2']) {
      for (const n of [3, 5, 6, 9, 12]) {
        const view = computeView({ cameras: cams(n), layout, per: 'all', width, height, gap: 4 });
        const feat = Math.min(...view.items.filter((i) => i.featured).map((i) => i.rect.w * i.rect.h));
        const other = Math.max(...view.items.filter((i) => !i.featured).map((i) => i.rect.w * i.rect.h));
        assert.ok(feat >= 1.55 * other, `${width}x${height} ${layout} n=${n}: destaque ${feat} vs ${other}`);
      }
    }
  }
});

test('tela em pé (celular/tablet): tiles na largura, página rola e preenche a altura', () => {
  const view = computeView({ cameras: cams(6), layout: 'equal', per: 'auto', width: 390, height: 640, gap: 6 });
  assert.equal(view.stack, true);
  assert.equal(view.pages, 1); // "auto" em tela em pé = todas, com rolagem
  assert.equal(view.items.length, 6);
  assert.ok(view.contentHeight >= 640 * 0.85, `conteúdo ${view.contentHeight} não preenche a tela`);
  for (const { rect } of view.items) assert.ok(rect.x >= 0 && rect.x + rect.w <= 390);

  // 16 câmeras: 2 colunas e muita rolagem
  const many = computeView({ cameras: cams(16), layout: 'equal', per: 'auto', width: 390, height: 640, gap: 6 });
  assert.ok(many.contentHeight > 640);
  assert.ok(many.items.every((i) => i.rect.w >= 170));
});

test('tela em pé com poucas câmeras: centraliza na vertical em vez de grudar no topo', () => {
  const view = computeView({ cameras: cams(1), layout: 'equal', per: 'auto', width: 390, height: 640, gap: 6 });
  assert.equal(view.contentHeight, 640);
  const { rect } = view.items[0];
  assert.equal(rect.w, 390);
  assert.ok(Math.abs(rect.y - (640 - rect.h) / 2) <= 1, `y=${rect.y}`);
});

test('tela em pé com destaque: o destaque ocupa a largura e as outras vêm embaixo', () => {
  const view = computeView({ cameras: cams(6), layout: 'focus1', per: 'auto', width: 390, height: 640, gap: 6 });
  const [featured, ...others] = view.items;
  assert.equal(featured.featured, true);
  assert.equal(featured.rect.w, 390);
  assert.ok(others.every((o) => o.rect.y >= featured.rect.y + featured.rect.h));
  assert.ok(others.some((o) => o.compact), 'as miniaturas pequenas são marcadas como compactas');
  assert.ok(view.contentHeight >= 640 * 0.85);
});

test('"2 destaques" em tela em pé: lado a lado só quando isso preenche a tela; senão empilha', () => {
  // Poucas câmeras no tablet: lado a lado deixaria a tela vazia, então os destaques ocupam a largura toda.
  const few = computeView({ cameras: cams(5), layout: 'focus2', per: 'all', width: 768, height: 1000, gap: 6 });
  assert.ok(few.items[1].rect.y > few.items[0].rect.y, 'deveria empilhar');
  assert.ok(few.contentHeight >= 1000 * 0.85);

  // Muitas câmeras: lado a lado já preenche e mostra mais coisa de uma vez.
  const many = computeView({ cameras: cams(40), layout: 'focus2', per: 'all', width: 768, height: 1000, gap: 6 });
  assert.equal(many.items[0].rect.y, many.items[1].rect.y, 'deveria ficar lado a lado');

  // Celular: nunca lado a lado (cada destaque ficaria do tamanho de uma miniatura)
  const phone = computeView({ cameras: cams(40), layout: 'focus2', per: 'all', width: 390, height: 640, gap: 6 });
  assert.ok(phone.items[1].rect.y > phone.items[0].rect.y);
});

test('"Auto" nunca deixa os tiles menores que o mínimo e pagina o resto (tela deitada)', () => {
  // 30 câmeras ainda cabem com tiles de ~316 px: mostra todas de uma vez
  const thirty = computeView({ cameras: cams(30), layout: 'equal', per: 'auto', width: 1920, height: 950, gap: 4 });
  assert.equal(thirty.pages, 1);
  assert.ok(thirty.items.every((i) => i.rect.w >= 260));

  // 80 não cabem sem ficar pequenas demais: pagina, e cada página respeita o mínimo
  const view = computeView({ cameras: cams(80), layout: 'equal', per: 'auto', width: 1920, height: 950, gap: 4 });
  assert.ok(view.pages > 1);
  assert.ok(view.items.every((i) => i.rect.w >= 260), `menor tile: ${Math.min(...view.items.map((i) => i.rect.w))}`);
  assert.equal(view.items.length, view.per);

  // poucas câmeras: mostra todas
  const few = computeView({ cameras: cams(5), layout: 'equal', per: 'auto', width: 1920, height: 950, gap: 4 });
  assert.equal(few.pages, 1);
  assert.equal(few.items.length, 5);
});

test('por página numérico conta os destaques; "todas" não pagina', () => {
  const view = computeView({ cameras: cams(10), layout: 'focus1', per: 4, width: 1920, height: 950, gap: 4 });
  assert.equal(view.items.length, 4); // 1 destaque + 3
  assert.equal(view.pages, 3); // 9 outras / 3
  assert.equal(computeView({ cameras: cams(10), layout: 'focus1', per: 4, page: 3, width: 1920, height: 950 }).items.length, 4);
  assert.equal(computeView({ cameras: cams(10), layout: 'equal', per: 'all', width: 1920, height: 950 }).pages, 1);
  // por página menor que (destaques + 1) é corrigido
  assert.equal(computeView({ cameras: cams(10), layout: 'focus2', per: 1, width: 1920, height: 950 }).items.length, 3);
  // página fora do intervalo é ajustada
  assert.equal(computeView({ cameras: cams(10), layout: 'equal', per: 4, page: 99, width: 1920, height: 950 }).page, 3);
});

test('destaques escolhidos têm prioridade; o que faltar completa com as primeiras', () => {
  const cameras = cams(5);
  assert.deepEqual(resolveFeatured(cameras, 'focus1', ['c4']).map((c) => c.id), ['c4']);
  assert.deepEqual(resolveFeatured(cameras, 'focus2', ['c4']).map((c) => c.id), ['c4', 'c1']);
  assert.deepEqual(resolveFeatured(cameras, 'focus2', ['c5', 'c2', 'c3']).map((c) => c.id), ['c5', 'c2']);
  assert.deepEqual(resolveFeatured(cameras, 'focus1', ['apagada']).map((c) => c.id), ['c1']);
  assert.deepEqual(resolveFeatured(cameras, 'equal', ['c2']), []);
  assert.deepEqual(resolveFeatured(cams(1), 'focus2').map((c) => c.id), ['c1']); // menos câmeras que destaques
});

test('tiles estreitos são marcados como compactos (miniaturas)', () => {
  const view = computeView({ cameras: cams(16), layout: 'equal', per: 'all', width: 1366, height: 650, gap: 4 });
  assert.ok(view.items.every((i) => i.compact === (i.rect.w < COMPACT_W)));
  const big = computeView({ cameras: cams(2), layout: 'equal', per: 'all', width: 1366, height: 650, gap: 4 });
  assert.ok(big.items.every((i) => !i.compact));
});

test('sem câmeras ou com área zero não quebra', () => {
  assert.deepEqual(computeView({ cameras: [], width: 800, height: 600 }).items, []);
  assert.deepEqual(computeView({ cameras: cams(3), width: 0, height: 0 }).items, []);
});

test('tela em pé: as outras câmeras são sempre menores que o destaque e a última fila nunca é esticada', () => {
  for (const [width, height] of [[768, 900], [390, 640], [600, 800], [320, 480]]) {
    for (const layout of ['focus1', 'focus2']) {
      for (const n of [3, 4, 5, 6, 7, 9, 12]) {
        const view = computeView({ cameras: cams(n), layout, per: 'all', width, height, gap: 6 });
        const featured = view.items.filter((i) => i.featured);
        const others = view.items.filter((i) => !i.featured);
        const label = `${width}x${height} ${layout} n=${n}`;
        const maxOther = Math.max(...others.map((i) => i.rect.w * i.rect.h));
        const minFeatured = Math.min(...featured.map((i) => i.rect.w * i.rect.h));
        assert.ok(minFeatured >= 1.5 * maxOther, `${label}: destaque ${minFeatured} vs outra ${maxOther}`);
        assert.equal(new Set(others.map((i) => i.rect.w)).size, 1, `${label}: as outras não têm o mesmo tamanho`);
      }
    }
  }
});

test('tela em pé, "Iguais": todos os tiles têm exatamente o mesmo tamanho (a última fila é centralizada)', () => {
  for (const [width, height] of [[768, 900], [390, 640], [600, 800]]) {
    for (const n of [2, 3, 5, 7, 9, 13]) {
      const view = computeView({ cameras: cams(n), layout: 'equal', per: 'all', width, height, gap: 6 });
      assert.equal(new Set(view.items.map((i) => `${i.rect.w}x${i.rect.h}`)).size, 1, `${width}x${height} n=${n}`);
      // última fila centralizada: sobras iguais dos dois lados
      const lastY = Math.max(...view.items.map((i) => i.rect.y));
      const lastRow = view.items.filter((i) => i.rect.y === lastY).map((i) => i.rect);
      const left = Math.min(...lastRow.map((r) => r.x));
      const right = width - Math.max(...lastRow.map((r) => r.x + r.w));
      assert.ok(Math.abs(left - right) <= 1, `${width}x${height} n=${n}: sobras ${left}/${right}`);
    }
  }
});

test('tela em pé + "Preencher": estica as alturas e cobre 100% da altura; "Inteira" alinha no topo se sobra pouco', () => {
  // `full`: casos em que dá para cobrir tudo sem deixar nenhum tile mais alto que largo.
  // 1 destaque + 2 miniaturas num celular em pé não dá (chega a ~85%): o limite é físico.
  for (const [layout, n, full] of [['focus1', 3, false], ['focus1', 6, true], ['equal', 2, true], ['focus2', 4, true]]) {
    const view = computeView({ cameras: cams(n), layout, per: 'all', fit: 'cover', width: 390, height: 700, gap: 6 });
    assert.ok(view.contentHeight >= 700, `${layout} n=${n}`);
    const bottom = Math.max(...view.items.map((i) => i.rect.y + i.rect.h));
    assert.ok(bottom >= 700 * (full ? 0.97 : 0.8), `${layout} n=${n}: termina em ${bottom} de 700`);
    assert.ok(view.items.every((i) => i.rect.w / i.rect.h >= 1), `${layout} n=${n}: tile mais alto que largo`);
    assertNoOverlap(view.items.map((i) => i.rect), `${layout} n=${n}`);
  }
  // "Inteira": pouco espaço sobrando -> topo; muito espaço sobrando -> centralizado
  const near = computeView({ cameras: cams(6), layout: 'focus1', per: 'all', width: 390, height: 700, gap: 6 });
  assert.equal(near.items[0].rect.y, 0);
  const far = computeView({ cameras: cams(1), layout: 'equal', per: 'all', width: 390, height: 700, gap: 6 });
  assert.ok(far.items[0].rect.y > 100);
});
