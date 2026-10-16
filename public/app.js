import {
  FIT_LABELS, LAYOUT_LABELS, PER_OPTIONS, buildQuery, deviceLayout, parseQuery, toSaved, toggleFeatured, withLayout,
} from './layout.js';
import { LAYOUTS, computeView } from './packing.js';
import { startRealtime } from './realtime.js';
import { startTile } from './tiles.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const LAYOUT_ICONS = { equal: '▦', focus1: '◧', focus2: '◫' };
const COMPACT_DELAY_MS = 3000; // miniaturas (tiles estreitos) atualizam no máximo a cada 3 s, em snapshot
const FIT_HINTS = {
  contain: 'Imagem inteira, sem cortar (pode sobrar uma faixa). Clique para preencher a tela.',
  cover: 'Preenche toda a área e corta um pouco das bordas. Clique para ver a imagem inteira.',
};

let config = null;
let canEdit = false; // reordenar câmeras exige login
let state = null; // visualização atual: { layout, per, fit, focusIds, page }
let mounted = null; // o que está na tela: { tiles: Map(id -> { tile, item }), view }
let lastSize = '';

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// ---- Preferência de visualização (por navegador) ---------------------------------------------

// A última visualização escolhida (layout, câmeras por página, ajuste e destaques) fica neste navegador.
const VIEW_KEY = 'painelcam.view';

function loadSavedView() {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY));
    return saved && typeof saved === 'object' ? saved : null;
  } catch {
    return null; // sem armazenamento (modo privado, bloqueado) ou valor inválido
  }
}

function saveView(view) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch { /* sem armazenamento: a preferência só não persiste */ }
}

// ---- Modo e atualização de cada câmera -----------------------------------------------------------

/**
 * Modo efetivo da câmera: o dela sobrescreve o global. Tempo real exige FFmpeg
 * no servidor; sem ele a câmera cai em snapshot (que continua sendo o padrão).
 */
function modeOf(camera) {
  const wanted = camera.streamMode ?? config.streamMode;
  return wanted === 'realtime' && config.realtime.available ? 'realtime' : 'snapshot';
}

const delayOf = (camera) => camera.refreshDelayMs ?? config.refreshDelayMs;

/** Miniatura (tile estreito): sempre snapshot e mais devagar, para poupar rede, bateria e FFmpeg. */
const tileMode = (item) => (item.compact ? 'snapshot' : modeOf(item.camera));
const tileDelay = (item) => (item.compact ? Math.max(COMPACT_DELAY_MS, delayOf(item.camera)) : delayOf(item.camera));

// ---- Requisições: só das câmeras que estão visíveis na tela ----------------------------------

const visible = new Set();
const snapshotStops = new Map(); // id -> parar o snapshot
let observer = null;
let realtime = null;
let running = false;

/** Liga/desliga cada câmera conforme ela aparece ou sai da tela (rolagem, aba oculta, outra página). */
function sync() {
  if (!mounted) return;
  const live = new Map();
  for (const [id, { tile, item }] of mounted.tiles) {
    const wanted = running && visible.has(id);
    if (tile.dataset.mode === 'snapshot') {
      if (wanted && !snapshotStops.has(id)) snapshotStops.set(id, startTile(tile, item.camera, tileDelay(item)));
      else if (!wanted && snapshotStops.has(id)) {
        snapshotStops.get(id)();
        snapshotStops.delete(id);
      }
    } else if (wanted) {
      live.set(id, tile);
    }
  }
  if (live.size && !realtime) realtime = startRealtime(live);
  else realtime?.setTiles(live);
}

function startViews() {
  if (!mounted || running) return;
  running = true;
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target.dataset.id);
      else visible.delete(entry.target.dataset.id);
    }
    sync();
  }, { root: $('grid'), rootMargin: '120px 0px' });
  mounted.tiles.forEach(({ tile }) => observer.observe(tile));
}

function stopViews() {
  running = false;
  observer?.disconnect();
  observer = null;
  visible.clear();
  snapshotStops.forEach((stop) => stop());
  snapshotStops.clear();
  realtime?.();
  realtime = null;
}

// ---- Renderização ------------------------------------------------------------------------------

const gapFor = (width) => (width <= 700 ? 6 : 4);

function compute() {
  const grid = $('grid');
  const run = () => computeView({
    cameras: config.cameras, ...state, width: grid.clientWidth, height: grid.clientHeight, gap: gapFor(grid.clientWidth),
  });
  let view = run();
  // A barra de rolagem (quando há) tira largura: recalcula uma vez já com ela.
  const scrolls = view.contentHeight > grid.clientHeight;
  if (grid.classList.toggle('scroll', scrolls) && scrolls) view = run();
  return view;
}

function place(tile, rect) {
  Object.assign(tile.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
}

function buildTile(item) {
  const { camera, featured, compact } = item;
  const mode = tileMode(item);
  const tile = el('figure', { className: `tile${featured ? ' featured' : ''}${compact ? ' compact' : ''}` },
    el('img', { alt: camera.name, draggable: false }),
    el('div', { className: 'msg' }),
    el('figcaption', {},
      el('span', { className: 'dot' }),
      el('span', { className: 'name' }, camera.name),
      mode === 'realtime' ? el('span', { className: 'badge', title: 'Vídeo em tempo real' }, 'AO VIVO') : '',
      el('a', {
        className: 'focus-btn',
        href: buildQuery(toggleFeatured(state, config.cameras, camera.id)),
        title: featured ? 'Tirar do destaque' : 'Destacar esta câmera',
        ariaLabel: featured ? `Tirar ${camera.name} do destaque` : `Destacar ${camera.name}`,
      }, featured ? '⤡' : '⤢')));
  tile.dataset.id = camera.id;
  tile.dataset.mode = mode;
  place(tile, item.rect);
  return tile;
}

function renderEmpty(grid) {
  grid.append(el('div', { className: 'empty' },
    el('p', {}, 'Nenhuma câmera cadastrada.'),
    el('a', { className: 'btn primary', href: '/config.html' }, 'Cadastrar câmeras')));
}

function mount(view) {
  const grid = $('grid');
  grid.replaceChildren();
  mounted = null;
  if (!config.cameras.length) return renderEmpty(grid);

  const canvas = el('div', { className: 'canvas' });
  canvas.style.height = `${view.contentHeight}px`;
  const tiles = new Map();
  for (const item of view.items) {
    const tile = buildTile(item);
    canvas.append(tile);
    tiles.set(item.camera.id, { tile, item });
  }
  grid.append(canvas);
  mounted = { tiles, view };
}

const sizeOfGrid = () => `${$('grid').clientWidth}x${$('grid').clientHeight}`;

function render() {
  stopViews();
  state = parseQuery(location.search, loadSavedView(), deviceLayout(window.innerWidth));
  // Escolha explícita (botões, destaque, paginação, link): vira a preferência. Abrir sem querystring só a reutiliza.
  if (/[?&](layout|grid|per)=/.test(location.search)) saveView(toSaved(state));

  const view = compute();
  mount(view);
  renderControls(view);
  renderDrawerList();
  lastSize = sizeOfGrid();
  if (!document.hidden) startViews();
}

/** Mudou o tamanho da janela: reposiciona sem refazer as requisições (só reconstrói se o conjunto mudou). */
function relayout() {
  if (!config || !mounted || sizeOfGrid() === lastSize) return;

  const view = compute();
  const same = view.items.length === mounted.tiles.size
    && view.page === mounted.view.page
    && view.items.every((item) => {
      const current = mounted.tiles.get(item.camera.id);
      return current && current.item.featured === item.featured && current.item.compact === item.compact;
    });
  if (!same) return render();

  for (const item of view.items) {
    const entry = mounted.tiles.get(item.camera.id);
    entry.item = item;
    place(entry.tile, item.rect);
  }
  document.querySelector('#grid .canvas').style.height = `${view.contentHeight}px`;
  mounted.view = view;
  lastSize = sizeOfGrid();
}

// ---- Controles: disposição, por página, ajuste e paginação -----------------------------------------

function renderControls(view) {
  $('layouts').replaceChildren(...LAYOUTS.map((layout) => {
    const active = layout === state.layout;
    return el('a', {
      href: buildQuery(withLayout(state, config.cameras, layout)),
      className: active ? 'active' : '',
      title: LAYOUT_LABELS[layout],
      ariaCurrent: active ? 'page' : null,
    }, el('span', { className: 'icon', ariaHidden: 'true' }, LAYOUT_ICONS[layout]), el('span', { className: 'text' }, LAYOUT_LABELS[layout]));
  }));

  const select = $('per');
  const minPer = view.k + (config.cameras.length > view.k ? 1 : 0);
  select.replaceChildren(...PER_OPTIONS.map((value) => {
    const label = value === 'auto' ? `Auto (${view.per})` : value === 'all' ? 'Todas' : String(value);
    return el('option', { value: String(value), textContent: label, disabled: typeof value === 'number' && value < minPer });
  }));
  select.value = String(state.per);
  select.onchange = () => {
    const per = select.value === 'auto' || select.value === 'all' ? select.value : Number(select.value);
    location.search = buildQuery({ ...state, per, page: 1 });
  };

  const fit = $('fit');
  fit.href = buildQuery({ ...state, fit: state.fit === 'cover' ? 'contain' : 'cover' });
  fit.title = FIT_HINTS[state.fit];
  fit.replaceChildren(
    el('span', { className: 'icon', ariaHidden: 'true' }, state.fit === 'cover' ? '⛶' : '▭'),
    el('span', { className: 'text' }, `Ajuste: ${FIT_LABELS[state.fit]}`));
  $('grid').classList.toggle('cover', state.fit === 'cover');

  const pager = $('pager');
  pager.replaceChildren();
  if (view.pages <= 1) return;
  const go = (page) => buildQuery({ ...state, page });
  pager.append(
    el('a', { href: go(view.page - 1), className: `btn${view.page <= 1 ? ' disabled' : ''}`, ariaLabel: 'Página anterior' }, '‹'),
    el('span', {}, `${view.page} / ${view.pages}`),
    el('a', { href: go(view.page + 1), className: `btn${view.page >= view.pages ? ' disabled' : ''}`, ariaLabel: 'Próxima página' }, '›'));
}

// ---- Menu lateral: ordem das câmeras ---------------------------------------------------------------

function renderDrawerList() {
  const list = $('drawer-list');
  list.replaceChildren();
  $('drawer-hint').replaceChildren(canEdit
    ? 'Arraste ou use ▲▼ para mudar a ordem.'
    : el('span', {}, 'Para mudar a ordem, ', el('a', { href: '/config.html' }, 'entre em Configurações'), '.'));
  const last = config.cameras.length - 1;
  config.cameras.forEach((camera, i) => {
    const li = el('li', { draggable: canEdit },
      el('span', { className: 'grip', ariaHidden: 'true' }, '⠿'),
      el('span', { className: 'name' }, camera.name),
      el('button', { className: 'icon-btn sm', disabled: !canEdit || i === 0, title: 'Subir', ariaLabel: `Subir ${camera.name}`, onclick: () => move(i, i - 1) }, '▲'),
      el('button', { className: 'icon-btn sm', disabled: !canEdit || i === last, title: 'Descer', ariaLabel: `Descer ${camera.name}`, onclick: () => move(i, i + 1) }, '▼'));
    li.dataset.index = i;
    list.append(li);
  });
}

let saving = Promise.resolve();
function move(from, to) {
  if (!canEdit || to < 0 || to >= config.cameras.length || from === to) return;
  const [item] = config.cameras.splice(from, 1);
  config.cameras.splice(to, 0, item);
  render();
  const ids = config.cameras.map((c) => c.id);
  // Serializa os salvamentos para a última ordem sempre vencer.
  saving = saving.then(() => api('/api/cameras/order', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })).catch(async (err) => {
    alert(`Não foi possível salvar a ordem: ${err.message}`);
    // Sessão expirada ou erro: volta ao que o servidor tem, em vez de mostrar uma ordem que não foi salva.
    canEdit = (await api('/api/session').catch(() => ({}))).authenticated === true;
    config = await api('/api/config').catch(() => config);
    render();
  });
}

function setupDragAndDrop() {
  const list = $('drawer-list');
  let from = null;
  list.addEventListener('dragstart', (e) => {
    from = Number(e.target.closest('li')?.dataset.index);
    e.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragover', (e) => { if (from !== null) e.preventDefault(); });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const to = Number(e.target.closest('li')?.dataset.index);
    if (from !== null && !Number.isNaN(to)) move(from, to);
    from = null;
  });
  list.addEventListener('dragend', () => { from = null; });
}

function setupDrawer() {
  const toggle = (open) => {
    $('drawer').hidden = !open;
    $('scrim').hidden = !open;
    $('menu-btn').setAttribute('aria-expanded', String(open));
  };
  $('menu-btn').addEventListener('click', () => toggle($('drawer').hidden));
  $('scrim').addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
}

// ---- Início -------------------------------------------------------------------------------------------

setupDrawer();
setupDragAndDrop();

// Aba em segundo plano não precisa consultar as câmeras.
document.addEventListener('visibilitychange', () => (document.hidden ? stopViews() : config && startViews()));

// Girar o aparelho ou redimensionar a janela reposiciona as câmeras, sem recarregar a página.
let resizeFrame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(relayout);
}).observe($('grid'));

try {
  [config, canEdit] = await Promise.all([
    api('/api/config'),
    api('/api/session').then((session) => session.authenticated === true).catch(() => false),
  ]);
  render();
} catch (err) {
  $('grid').replaceChildren(el('div', { className: 'empty' }, el('p', {}, `Erro ao carregar: ${err.message}`)));
}
