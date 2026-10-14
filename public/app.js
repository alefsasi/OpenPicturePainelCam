import { GRIDS, buildQuery, computeView, focusSpan, parseQuery } from './layout.js';
import { startRealtime } from './realtime.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

let config = null;
let stopTiles = [];

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// ---- Atualização das imagens -------------------------------------------------

/**
 * Cada tile pede o próximo snapshot `delay` ms depois do início do anterior
 * (nunca sobrepõe pedidos: se a câmera demorar mais que o delay, espera ela).
 * Só existem tiles para as câmeras visíveis, então só elas são consultadas.
 */
function startTile(tile, camera, delay) {
  const img = tile.querySelector('img');
  let timer = null;
  let aborter = null;
  let stopped = false;
  let lastUrl = null;

  async function tick() {
    const started = performance.now();
    aborter = new AbortController();
    try {
      const res = await fetch(`/api/cameras/${camera.id}/snapshot?t=${Date.now()}`, { cache: 'no-store', signal: aborter.signal });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      img.src = url;
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = url;
      tile.classList.remove('offline');
      tile.removeAttribute('title');
    } catch (err) {
      if (stopped) return;
      tile.classList.add('offline');
      tile.title = err.message;
      tile.querySelector('.msg').textContent = err.message;
    }
    if (!stopped) timer = setTimeout(tick, Math.max(0, delay - (performance.now() - started)));
  }

  tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    aborter?.abort();
    if (lastUrl) URL.revokeObjectURL(lastUrl);
  };
}

function stopAll() {
  stopTiles.forEach((stop) => stop());
  stopTiles = [];
}

// ---- Renderização ------------------------------------------------------------

function render() {
  stopAll();
  const view = computeView(parseQuery(location.search, config.defaultView, config.cameras), config.cameras);
  renderGrid(view);
  renderLayouts(view);
  renderPager(view);
  renderDrawerList();
  if (!document.hidden) startTiles();
}

/**
 * Modo efetivo da câmera: o dela sobrescreve o global. Tempo real exige FFmpeg
 * no servidor; sem ele a câmera cai em snapshot (que continua sendo o padrão).
 */
function modeOf(camera) {
  const wanted = camera.streamMode ?? config.streamMode;
  return wanted === 'realtime' && config.realtime.available ? 'realtime' : 'snapshot';
}

function startTiles() {
  stopAll();
  const live = new Map();
  document.querySelectorAll('.tile').forEach((tile) => {
    const camera = config.cameras.find((c) => c.id === tile.dataset.id);
    if (tile.dataset.mode === 'realtime') {
      live.set(camera.id, tile);
      return;
    }
    // O delay da câmera sobrescreve o global.
    stopTiles.push(startTile(tile, camera, camera.refreshDelayMs ?? config.refreshDelayMs));
  });
  if (live.size) stopTiles.push(startRealtime(live));
}

function renderGrid(view) {
  const grid = $('grid');
  grid.replaceChildren();
  grid.style.setProperty('--n', view.grid);

  if (!config.cameras.length) {
    grid.append(el('div', { className: 'empty' },
      el('p', {}, 'Nenhuma câmera cadastrada.'),
      el('a', { className: 'btn primary', href: '/config.html' }, 'Cadastrar câmeras')));
    return;
  }

  view.items.forEach((camera) => {
    const isFocus = camera === view.focus;
    const mode = modeOf(camera);
    const tile = el('figure', { className: `tile${isFocus ? ' focus' : ''}` },
      el('img', { alt: camera.name, draggable: false }),
      el('div', { className: 'msg' }),
      el('figcaption', {},
        el('span', { className: 'dot' }),
        el('span', { className: 'name' }, camera.name),
        mode === 'realtime' ? el('span', { className: 'badge', title: 'Vídeo em tempo real' }, 'AO VIVO') : '',
        el('a', {
          className: 'focus-btn',
          href: focusHref(view, camera, isFocus),
          title: isFocus ? 'Sair do foco' : 'Destacar esta câmera',
          ariaLabel: isFocus ? 'Sair do foco' : `Destacar ${camera.name}`,
        }, isFocus ? '⤡' : '⤢')));
    tile.dataset.id = camera.id;
    tile.dataset.mode = mode;
    if (isFocus) {
      tile.style.gridColumn = `span ${view.span}`;
      tile.style.gridRow = `span ${view.span}`;
    }
    grid.append(tile);
  });
}

/** Destacar uma câmera exige uma grid com foco: se não tiver, vai para 3x3. */
function focusHref(view, camera, isFocus) {
  if (isFocus) return buildQuery({ grid: view.grid, focusId: null, page: view.page });
  const grid = focusSpan(view.grid) ? view.grid : 3;
  return buildQuery({ grid, focusId: camera.id, page: 1 });
}

function renderLayouts(view) {
  const nav = $('layouts');
  nav.replaceChildren();
  const link = (label, query, active, title) =>
    el('a', { href: buildQuery(query), className: active ? 'active' : '', title, ariaCurrent: active ? 'page' : null }, label);

  GRIDS.forEach((n) => {
    nav.append(link(n === 1 ? '1' : `${n}×${n}`, { grid: n, focusId: null, page: 1 }, n === view.grid && !view.focus,
      n === 1 ? '1 câmera' : `${n * n} câmeras`));
  });
  [3, 4].forEach((n) => {
    // Sem câmera escolhida ainda, o foco começa na primeira da lista.
    const focusId = view.focus?.id ?? config.cameras[0]?.id ?? null;
    nav.append(link(`${n}×${n}★`, { grid: n, focusId, page: 1 }, n === view.grid && !!view.focus,
      `Grid ${n}×${n} com uma câmera em foco`));
  });
}

function renderPager(view) {
  const nav = $('pager');
  nav.replaceChildren();
  if (view.pages <= 1) return;
  const go = (page) => buildQuery({ ...view.query, page });
  nav.append(
    el('a', { href: go(view.page - 1), className: `btn${view.page <= 1 ? ' disabled' : ''}`, ariaLabel: 'Página anterior' }, '‹'),
    el('span', {}, `${view.page} / ${view.pages}`),
    el('a', { href: go(view.page + 1), className: `btn${view.page >= view.pages ? ' disabled' : ''}`, ariaLabel: 'Próxima página' }, '›'));
}

// ---- Menu lateral: ordem das câmeras ---------------------------------------

function renderDrawerList() {
  const list = $('drawer-list');
  list.replaceChildren();
  const last = config.cameras.length - 1;
  config.cameras.forEach((camera, i) => {
    const li = el('li', { draggable: true },
      el('span', { className: 'grip', ariaHidden: 'true' }, '⠿'),
      el('span', { className: 'name' }, camera.name),
      el('button', { className: 'icon-btn sm', disabled: i === 0, title: 'Subir', ariaLabel: `Subir ${camera.name}`, onclick: () => move(i, i - 1) }, '▲'),
      el('button', { className: 'icon-btn sm', disabled: i === last, title: 'Descer', ariaLabel: `Descer ${camera.name}`, onclick: () => move(i, i + 1) }, '▼'));
    li.dataset.index = i;
    list.append(li);
  });
}

let saving = Promise.resolve();
function move(from, to) {
  if (to < 0 || to >= config.cameras.length || from === to) return;
  const [item] = config.cameras.splice(from, 1);
  config.cameras.splice(to, 0, item);
  render();
  const ids = config.cameras.map((c) => c.id);
  // Serializa os salvamentos para a última ordem sempre vencer.
  saving = saving.then(() => api('/api/cameras/order', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })).catch((err) => alert(`Não foi possível salvar a ordem: ${err.message}`));
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

// ---- Início -------------------------------------------------------------------

setupDrawer();
setupDragAndDrop();

// Aba em segundo plano não precisa consultar as câmeras.
document.addEventListener('visibilitychange', () => (document.hidden ? stopAll() : config && startTiles()));

try {
  config = await api('/api/config');
  render();
} catch (err) {
  $('grid').replaceChildren(el('div', { className: 'empty' }, el('p', {}, `Erro ao carregar: ${err.message}`)));
}
