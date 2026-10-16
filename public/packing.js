// Cálculo puro (sem DOM) de onde cada câmera fica na tela. As câmeras são 16:9, então o
// objetivo é cobrir a área disponível com tiles 16:9 o maior possível, sem sobrar espaço à toa.
//
// Duas famílias de geometria:
//  - telas "deitadas" (largura >= altura): tudo cabe na tela, sem rolagem;
//  - telas "em pé" (celular/tablet na vertical): tiles ocupam a largura e a página rola.
// E dois ajustes: 'contain' (tile exatamente 16:9, nada é cortado) e 'cover' (os tiles ocupam
// 100% da área, com formato próximo de 16:9 e a imagem cortada nas bordas).

export const RATIO = 16 / 9;
export const COMPACT_W = 220; // tile mais estreito que isso é tratado como miniatura (atualiza mais devagar)

const FEATURE_MIN_AREA = 1.6; // o destaque precisa ter pelo menos 1,6x a área de cada uma das outras
const EQUAL_MIN_W = 170; // em tela em pé: largura mínima de um tile de grade
const THUMB_MIN_W = 150; // em tela em pé: largura mínima de uma miniatura ao lado do destaque
const AUTO_EQUAL_MIN_W = 260; // "Auto": não deixa os tiles ficarem menores que isso
const AUTO_THUMB_MIN_W = 170;
const CENTER_BELOW = 0.7; // tela em pé: só centraliza na vertical se o conteúdo ocupar menos que isso da altura
const FILL_THRESHOLD = 0.85; // conteúdo que ocupa 85% da altura já conta como "preenche a tela"
const SPLITS = Array.from({ length: 46 }, (_, i) => 0.4 + i * 0.01); // fração da tela dada ao destaque

const roundRect = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
const aspectError = (w, h) => Math.abs(Math.log(w / h / RATIO));
const shift = (rects, dx, dy) => rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
const minWidth = (rects) => (rects.length ? Math.min(...rects.map((r) => r.w)) : Infinity);
const areaOf = (r) => r.w * r.h;

// ---- Grade de tiles iguais ------------------------------------------------------------------

/**
 * Melhor grade para `count` tiles 16:9 dentro de w x h: escolhe o nº de colunas que deixa o tile
 * maior. A última fila incompleta e o conjunto todo ficam centralizados.
 */
export function fitGrid(count, w, h, gap = 0) {
  if (count <= 0 || w <= 0 || h <= 0) return { rects: [], tileW: 0, tileH: 0, cols: 0, rows: 0 };

  let best = null;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const tileW = Math.min((w - gap * (cols - 1)) / cols, ((h - gap * (rows - 1)) / rows) * RATIO);
    if (tileW <= 0) continue;
    const empty = cols * rows - count;
    const better = !best || tileW > best.tileW * 1.0001 || (Math.abs(tileW - best.tileW) <= best.tileW * 1e-4 && empty < best.empty);
    if (better) best = { cols, rows, tileW, empty };
  }
  if (!best) return { rects: [], tileW: 0, tileH: 0, cols: 0, rows: 0 };

  const { cols, rows } = best;
  const tileW = Math.floor(best.tileW);
  const tileH = Math.floor(tileW / RATIO);
  const blockW = cols * tileW + gap * (cols - 1);
  const blockH = rows * tileH + gap * (rows - 1);
  const left = (w - blockW) / 2;
  const top = (h - blockH) / 2;

  const rects = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? count - cols * (rows - 1) : cols;
    const rowLeft = left + ((cols - inRow) * (tileW + gap)) / 2; // centraliza a última fila
    rects.push(roundRect(rowLeft + (i % cols) * (tileW + gap), top + row * (tileH + gap), tileW, tileH));
  }
  return { rects, tileW, tileH, cols, rows };
}

/**
 * Cobre w x h por completo com `count` células (a última fila se estica para não deixar buraco).
 * Escolhe as colunas que deixam as células mais perto de 16:9, para cortar o mínimo da imagem.
 */
export function fillGrid(count, w, h, gap = 0) {
  if (count <= 0 || w <= 0 || h <= 0) return { rects: [], tileW: 0, tileH: 0, cols: 0, rows: 0 };

  let best = null;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellH = (h - gap * (rows - 1)) / rows;
    const lastItems = count - cols * (rows - 1);
    const fullW = (w - gap * (cols - 1)) / cols;
    const lastW = (w - gap * (lastItems - 1)) / lastItems;
    if (cellH <= 0 || fullW <= 0) continue;
    const error = ((rows - 1) * cols * aspectError(fullW, cellH) + lastItems * aspectError(lastW, cellH)) / count;
    if (!best || error < best.error - 1e-9) best = { cols, rows, error };
  }

  const { cols, rows } = best;
  const rects = [];
  for (let row = 0; row < rows; row++) {
    const items = row === rows - 1 ? count - cols * (rows - 1) : cols;
    const y0 = Math.round((row * (h + gap)) / rows);
    const y1 = Math.round(((row + 1) * (h + gap)) / rows) - gap;
    for (let i = 0; i < items; i++) {
      const x0 = Math.round((i * (w + gap)) / items);
      const x1 = Math.round(((i + 1) * (w + gap)) / items) - gap;
      rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  }
  return { rects, tileW: minWidth(rects), tileH: Math.min(...rects.map((r) => r.h)), cols, rows };
}

const grid = (cover) => (cover ? fillGrid : fitGrid);

// ---- Destaque(s) + outras, em tela deitada ---------------------------------------------------------

/**
 * Divide a tela em duas regiões (destaque à esquerda ou em cima) e escolhe a fração que melhor
 * aproveita a área. O destaque tem que ser claramente maior que as outras.
 */
function splitFocus({ k, m, w, h, gap, cover }) {
  const make = (strict, ratioRule) => {
    let best = null;
    for (const orientation of ['side', 'below']) {
      for (const s of SPLITS) {
        const side = orientation === 'side';
        const featSize = Math.round((side ? w : h) * s);
        const fRegion = side ? { x: 0, y: 0, w: featSize, h } : { x: 0, y: 0, w, h: featSize };
        const oRegion = side
          ? { x: featSize + gap, y: 0, w: w - featSize - gap, h }
          : { x: 0, y: featSize + gap, w, h: h - featSize - gap };
        if (oRegion.w < 40 || oRegion.h < 40) continue;

        const featured = grid(cover)(k, fRegion.w, fRegion.h, gap);
        const others = grid(cover)(m, oRegion.w, oRegion.h, gap);
        if (!featured.rects.length || !others.rects.length) continue;

        const featArea = Math.min(...featured.rects.map(areaOf));
        const otherArea = Math.max(...others.rects.map(areaOf));
        if (ratioRule && featArea < FEATURE_MIN_AREA * otherArea) continue;
        if (strict && minWidth(others.rects) < AUTO_THUMB_MIN_W - 20) continue;

        // contain: cobrir o máximo da tela; cover: a tela já é coberta, então vale o menor corte.
        const score = cover
          ? -(featured.rects.reduce((a, r) => a + aspectError(r.w, r.h) * areaOf(r), 0)
            + others.rects.reduce((a, r) => a + aspectError(r.w, r.h) * areaOf(r), 0)) / (w * h)
          : (featured.rects.reduce((a, r) => a + areaOf(r), 0) + others.rects.reduce((a, r) => a + areaOf(r), 0)) / (w * h)
            + 0.05 * (featArea / (w * h));
        if (!best || score > best.score) {
          best = { score, featured: shift(featured.rects, fRegion.x, fRegion.y), others: shift(others.rects, oRegion.x, oRegion.y) };
        }
      }
    }
    return best;
  };

  const found = make(true, true) ?? make(false, true) ?? make(false, false);
  if (found) return { featured: found.featured, others: found.others, contentHeight: h };

  const all = grid(cover)(k + m, w, h, gap).rects;
  return { featured: all.slice(0, k), others: all.slice(k), contentHeight: h };
}

// ---- Tela em pé: tiles na largura, com rolagem ------------------------------------------------------

/**
 * Empilha `count` tiles 16:9 de mesmo tamanho pela largura. Usa o maior nº de colunas que ainda
 * preenche a altura visível; se nenhum preencher, usa o menor nº permitido (tiles maiores).
 * `maxW` limita a largura do tile (as miniaturas têm que ficar menores que o destaque).
 * A última fila incompleta fica centralizada: os tiles nunca são esticados.
 */
function stackGrid(count, w, gap, minW, viewH, maxW = Infinity) {
  if (count <= 0) return { rects: [], height: 0 };
  const rowsFor = (cols) => {
    const rows = Math.ceil(count / cols);
    const tileW = (w - gap * (cols - 1)) / cols;
    const tileH = tileW / RATIO;
    const rects = [];
    for (let row = 0; row < rows; row++) {
      const items = row === rows - 1 ? count - cols * (rows - 1) : cols;
      const left = ((cols - items) * (tileW + gap)) / 2;
      for (let i = 0; i < items; i++) rects.push(roundRect(left + i * (tileW + gap), row * (tileH + gap), tileW, tileH));
    }
    // A altura vem das posições já arredondadas: nenhum tile passa do fim do conteúdo.
    return { rects, height: Math.max(...rects.map((r) => r.y + r.h)) };
  };

  const minCols = Math.max(1, Math.ceil((w + gap) / (maxW + gap)));
  const maxCols = Math.max(minCols, Math.min(count, Math.floor((w + gap) / (minW + gap))));
  for (let cols = maxCols; cols >= minCols; cols--) {
    const layout = rowsFor(cols);
    if (layout.height >= viewH * FILL_THRESHOLD) return layout;
  }
  return rowsFor(minCols);
}

function stackFocus({ k, m, w, h, gap }) {
  // Disposições do(s) destaque(s): 2 lado a lado (se couber) ou todos empilhados na largura.
  const variants = k === 2 && w >= 600 ? ['side', 'stacked'] : ['stacked'];
  let best = null;

  for (const variant of variants) {
    const featured = [];
    let y = 0;
    let featuredW = w;
    if (variant === 'side') {
      featuredW = (w - gap) / 2;
      featured.push(roundRect(0, 0, featuredW, featuredW / RATIO), roundRect(featuredW + gap, 0, featuredW, featuredW / RATIO));
      y = featuredW / RATIO + gap;
    } else {
      for (let i = 0; i < k; i++) {
        featured.push(roundRect(0, y, w, w / RATIO));
        y += w / RATIO + gap;
      }
    }
    // As outras câmeras têm que ser claramente menores que o destaque (mesma regra da tela deitada).
    const maxW = Math.floor(featuredW / Math.sqrt(FEATURE_MIN_AREA));
    const others = stackGrid(m, w, gap, THUMB_MIN_W, h - y, maxW);
    const placed = shift(others.rects, 0, Math.round(y));
    const candidate = {
      featured,
      others: placed,
      contentHeight: Math.max(...[...featured, ...placed].map((r) => r.y + r.h)),
    };
    if (candidate.contentHeight >= h * FILL_THRESHOLD) return candidate; // a primeira que preenche (mais câmeras por tela)
    if (!best || candidate.contentHeight > best.contentHeight) best = candidate;
  }
  return best;
}

// ---- Uma página ---------------------------------------------------------------------------------------

function arrangePage({ k, m, width, height, gap, fit, stack }) {
  const cover = fit === 'cover';
  const n = k + m;
  if (n === 0) return { featured: [], others: [], contentHeight: height };

  let page;
  if (k > 0 && m > 0) {
    page = stack ? stackFocus({ k, m, w: width, h: height, gap }) : splitFocus({ k, m, w: width, h: height, gap, cover });
  } else if (stack) {
    const { rects, height: contentHeight } = stackGrid(n, width, gap, EQUAL_MIN_W, height);
    page = { rects, contentHeight };
  } else {
    page = { rects: grid(cover)(n, width, height, gap).rects, contentHeight: height };
  }
  if (page.rects) page = k > 0 ? { featured: page.rects, others: [], contentHeight: page.contentHeight } : { featured: [], others: page.rects, contentHeight: page.contentHeight };

  // Tela em pé em que o conteúdo não chega ao fim da tela:
  //  - "Preencher": estica as alturas até cobrir tudo (a imagem corta um pouco no alto e embaixo);
  //  - "Inteira" com muito espaço sobrando: centraliza na vertical; com pouco, fica no topo.
  if (stack && page.contentHeight < height) {
    if (cover) {
      const stretched = stretchY(page, height);
      if (stretched) return stretched;
    }
    if (page.contentHeight < height * CENTER_BELOW) {
      const dy = Math.round((height - page.contentHeight) / 2);
      return { featured: shift(page.featured, 0, dy), others: shift(page.others, 0, dy), contentHeight: height };
    }
    return { ...page, contentHeight: height };
  }
  return page;
}

/** Estica todas as alturas na mesma proporção, sem deixar nenhum tile mais alto que largo. */
function stretchY(page, height) {
  const all = [...page.featured, ...page.others];
  const factor = Math.min(height / page.contentHeight, Math.min(...all.map((r) => r.w / r.h)));
  if (!(factor > 1)) return null;
  const apply = (rects) => rects.map((r) => ({ ...r, y: Math.round(r.y * factor), h: Math.floor(r.h * factor) }));
  const featured = apply(page.featured);
  const others = apply(page.others);
  return { featured, others, contentHeight: Math.max(height, ...[...featured, ...others].map((r) => r.y + r.h)) };
}

// ---- Escolha dos destaques e da página ---------------------------------------------------------------

export const LAYOUTS = ['equal', 'focus1', 'focus2'];
export const FEATURED_COUNT = { equal: 0, focus1: 1, focus2: 2 };

/** Destaques: os pedidos (que existam), completando com as primeiras da lista. */
export function resolveFeatured(cameras, layout, focusIds = []) {
  const wanted = FEATURED_COUNT[layout] ?? 0;
  const picked = [];
  for (const id of focusIds) {
    const camera = cameras.find((c) => c.id === id);
    if (camera && !picked.includes(camera) && picked.length < wanted) picked.push(camera);
  }
  for (const camera of cameras) {
    if (picked.length >= wanted) break;
    if (!picked.includes(camera)) picked.push(camera);
  }
  return picked;
}

/**
 * Tudo o que a tela precisa: quais câmeras aparecem na página e o retângulo de cada uma.
 * `per` = 'auto' (o máximo sem ficar pequeno), 'all' ou um número de tiles por página
 * (contando os destaques, que ficam fixos em todas as páginas).
 */
export function computeView({
  cameras, layout = 'equal', per = 'auto', focusIds = [], page = 1, fit = 'contain', width, height, gap = 4,
}) {
  if (!(width > 0) || !(height > 0)) return { items: [], page: 1, pages: 1, per: 0, k: 0, stack: false, contentHeight: 0 };

  const featured = resolveFeatured(cameras, layout, focusIds);
  const k = featured.length;
  const others = cameras.filter((c) => !featured.includes(c));
  const total = k + others.length;
  const stack = width / height < 1;
  const minTotal = k + (others.length ? 1 : 0);
  const arrange = (m) => arrangePage({ k, m, width, height, gap, fit, stack });

  let perPage;
  if (per === 'all' || (per === 'auto' && stack)) {
    perPage = total;
  } else if (per === 'auto') {
    perPage = minTotal;
    for (let t = total; t >= minTotal; t--) {
      const a = arrange(t - k);
      const small = k > 0 ? a.others : [...a.featured, ...a.others];
      if (!small.length || minWidth(small) >= (k > 0 ? AUTO_THUMB_MIN_W : AUTO_EQUAL_MIN_W)) {
        perPage = t;
        break;
      }
    }
  } else {
    perPage = Math.min(total, Math.max(Number(per) || 1, minTotal));
  }

  const slots = Math.max(1, perPage - k);
  const pages = Math.max(1, Math.ceil(others.length / slots));
  const current = Math.min(Math.max(1, page), pages);
  const visible = others.slice((current - 1) * slots, current * slots);
  const layoutRects = arrange(visible.length);

  const items = [
    ...featured.map((camera, i) => ({ camera, featured: true, rect: layoutRects.featured[i] })),
    ...visible.map((camera, i) => ({ camera, featured: false, rect: layoutRects.others[i] })),
  ].map((item) => ({ ...item, compact: item.rect.w < COMPACT_W }));

  return { items, page: current, pages, per: perPage, k, stack, contentHeight: layoutRects.contentHeight };
}
