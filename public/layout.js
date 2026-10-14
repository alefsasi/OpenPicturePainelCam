// Lógica pura da grid (sem DOM): querystring <-> visão, foco e paginação.
// Usada pelo navegador e pelos testes.

export const GRIDS = [1, 2, 3, 4];
export const DEFAULT_GRID = 2;

/** Lado (em células) do painel em foco: 3x3 -> 2x2 (4 posições), 4x4 -> 3x3 (9 posições). */
export function focusSpan(grid) {
  return grid === 3 ? 2 : grid === 4 ? 3 : 0;
}

export function parseQuery(search) {
  const q = new URLSearchParams(search);
  const grid = Number(q.get('grid'));
  const page = Number(q.get('page'));
  return {
    grid: GRIDS.includes(grid) ? grid : DEFAULT_GRID,
    focusId: q.get('focus') || null,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function buildQuery({ grid, focusId, page }) {
  const q = new URLSearchParams();
  q.set('grid', grid);
  if (focusId && focusSpan(grid)) q.set('focus', focusId);
  if (page > 1) q.set('page', page);
  return `?${q}`;
}

/**
 * Decide o que aparece na tela. Com foco, a câmera escolhida fica fixa em todas
 * as páginas e as demais se dividem nas células que sobram (grid² − span²).
 */
export function computeView(query, cameras) {
  const { grid } = query;
  const span = focusSpan(grid);
  const focus = span ? cameras.find((c) => c.id === query.focusId) ?? null : null;

  const others = focus ? cameras.filter((c) => c !== focus) : cameras;
  const perPage = focus ? grid * grid - span * span : grid * grid;
  const pages = Math.max(1, Math.ceil(others.length / perPage));
  const page = Math.min(query.page, pages);
  const slice = others.slice((page - 1) * perPage, page * perPage);

  return {
    grid,
    span: focus ? span : 0,
    focus,
    page,
    pages,
    items: focus ? [focus, ...slice] : slice,
    query: { grid, focusId: focus?.id ?? null, page },
  };
}
