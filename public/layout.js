// Estado da visualização (layout, câmeras por página, ajuste, destaques, página) <-> querystring.
// Lógica pura, sem DOM: usada pelo navegador e pelos testes. A geometria fica em packing.js.
import { FEATURED_COUNT, LAYOUTS, resolveFeatured } from './packing.js';

export const FITS = ['contain', 'cover'];
export const PER_OPTIONS = ['auto', 'all', 1, 2, 4, 6, 9, 12, 16];
export const LAYOUT_LABELS = { equal: 'Iguais', focus1: '1 destaque', focus2: '2 destaques' };
export const FIT_LABELS = { contain: 'Inteira', cover: 'Preencher' };

/** Quem abre pela primeira vez no celular começa com 1 destaque + miniaturas; no resto, tiles iguais. */
export const deviceLayout = (width) => (width <= 700 ? 'focus1' : 'equal');

const parsePer = (value) => {
  if (value === 'auto' || value === 'all') return value;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 64 ? n : null;
};
const parseIds = (value) => (value ? value.split(',').map((id) => id.trim()).filter(Boolean) : []);

/**
 * Lê a querystring. O que a URL não disser vem da última visualização salva neste navegador
 * (`saved`) e, por fim, do padrão do aparelho. Links da versão antiga (?grid=3&focus=id) continuam valendo.
 */
export function parseQuery(search, saved = null, defaultLayout = 'equal') {
  const q = new URLSearchParams(search);
  const hasView = q.has('layout') || q.has('grid') || q.has('per');

  let layout = LAYOUTS.includes(q.get('layout')) ? q.get('layout') : null;
  let per = parsePer(q.get('per'));

  const grid = Number(q.get('grid'));
  if (!layout && [1, 2, 3, 4].includes(grid)) {
    const span = grid === 3 ? 2 : grid === 4 ? 3 : 0; // antes: em 3x3 o foco ocupava 2x2; em 4x4, 3x3
    const focused = span && q.get('focus');
    layout = focused ? 'focus1' : 'equal';
    per ??= focused ? grid * grid - span * span + 1 : grid * grid;
  }

  layout ??= LAYOUTS.includes(saved?.layout) ? saved.layout : defaultLayout;
  per ??= parsePer(saved?.per) ?? 'auto';

  const page = Number(q.get('page'));
  return {
    layout,
    per,
    fit: FITS.includes(q.get('fit')) ? q.get('fit') : (!hasView && FITS.includes(saved?.fit) ? saved.fit : 'contain'),
    focusIds: q.has('focus') ? parseIds(q.get('focus')) : (!hasView && Array.isArray(saved?.focusIds) ? saved.focusIds : []),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function buildQuery({ layout, per, fit, focusIds, page }) {
  const q = new URLSearchParams();
  q.set('layout', layout);
  q.set('per', per);
  if (fit === 'cover') q.set('fit', 'cover');
  if (FEATURED_COUNT[layout] && focusIds?.length) q.set('focus', focusIds.slice(0, FEATURED_COUNT[layout]).join(','));
  if (page > 1) q.set('page', page);
  return `?${q}`;
}

/** O que fica salvo no navegador: a escolha de visualização, sem a página. */
export const toSaved = ({ layout, per, fit, focusIds }) => ({ layout, per, fit, focusIds });

/**
 * Clicar em "destacar" numa câmera: sem destaque vira 1 destaque; com 1 destaque troca; com 2 destaques
 * entra no lugar da mais antiga. Clicar numa já destacada a tira; sem nenhum destaque volta a "Iguais".
 */
export function toggleFeatured(state, cameras, id) {
  const current = resolveFeatured(cameras, state.layout, state.focusIds).map((c) => c.id);
  let ids;
  if (current.includes(id)) ids = current.filter((x) => x !== id);
  else if (state.layout === 'focus2') ids = [...current, id].slice(-2);
  else ids = [id];
  const layout = ids.length >= 2 ? 'focus2' : ids.length === 1 ? 'focus1' : 'equal';
  return { ...state, layout, focusIds: ids, page: 1 };
}

/** Trocar de layout mantém os destaques que já existiam (o que sobrar completa com as primeiras). */
export function withLayout(state, cameras, layout) {
  const keep = resolveFeatured(cameras, state.layout, state.focusIds).map((c) => c.id);
  return { ...state, layout, focusIds: FEATURED_COUNT[layout] ? keep.slice(0, FEATURED_COUNT[layout]) : [], page: 1 };
}
