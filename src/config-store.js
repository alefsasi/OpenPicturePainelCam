// Configuração local em JSON: câmeras (nome + IP), credenciais e delay.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export const DEFAULT_DELAY_MS = 1000;
const MIN_DELAY_MS = 100;
const MAX_DELAY_MS = 600_000;

// host, host:porta, IPv4 ou [IPv6]:porta. Barra e afins ficam de fora de propósito:
// o valor vira parte da URL que o servidor acessa.
const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])(?::\d{1,5})?$/;

export class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

const validDelay = (n) => Number.isInteger(n) && n >= MIN_DELAY_MS && n <= MAX_DELAY_MS;
const DELAY_ERROR = `O delay deve ser um inteiro entre ${MIN_DELAY_MS} e ${MAX_DELAY_MS} ms`;

/** Delay opcional da câmera: vazio/null = usar o global (null). */
function parseOptionalDelay(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!validDelay(n)) throw new ValidationError(DELAY_ERROR);
  return n;
}

// Modo de atualização: 'snapshot' (imagens, padrão) ou 'realtime' (vídeo via FFmpeg).
export const STREAM_MODES = ['snapshot', 'realtime'];
export const DEFAULT_REALTIME = { fps: 10, maxWidth: 640 };
const FPS_RANGE = [1, 30];
const WIDTH_RANGE = [160, 1920];
const PORT_RANGE = [1, 65535];

const inRange = (n, [min, max]) => Number.isInteger(n) && n >= min && n <= max;
const isEmpty = (v) => v === undefined || v === null || v === '';

/** Modo opcional da câmera: vazio/null = usar o global (null). */
function parseOptionalMode(value) {
  if (isEmpty(value) || value === 'default') return null;
  if (!STREAM_MODES.includes(value)) throw new ValidationError('Modo de atualização inválido');
  return value;
}

function parseOptionalPort(value) {
  if (isEmpty(value)) return null;
  const n = Number(value);
  if (!inRange(n, PORT_RANGE)) throw new ValidationError(`Porta RTSP inválida (${PORT_RANGE[0]}-${PORT_RANGE[1]})`);
  return n;
}

function parseRealtime(input) {
  const fps = Number(input?.fps);
  const maxWidth = Number(input?.maxWidth);
  if (!inRange(fps, FPS_RANGE)) throw new ValidationError(`FPS do tempo real deve estar entre ${FPS_RANGE[0]} e ${FPS_RANGE[1]}`);
  if (!inRange(maxWidth, WIDTH_RANGE)) throw new ValidationError(`Largura do tempo real deve estar entre ${WIDTH_RANGE[0]} e ${WIDTH_RANGE[1]} px`);
  return { fps, maxWidth };
}

// Visualização usada quando a URL não traz `grid`. Foco só existe em 3x3 e 4x4.
export const DEFAULT_VIEW = { grid: 2, focus: false };
const GRID_SIZES = [1, 2, 3, 4];

function parseDefaultView(input) {
  const grid = Number(input?.grid);
  const focus = input?.focus === true;
  if (!GRID_SIZES.includes(grid)) throw new ValidationError('Grid padrão inválida (use 1, 2, 3 ou 4)');
  if (focus && grid < 3) throw new ValidationError('Câmera em foco só existe nas grids 3×3 e 4×4');
  return { grid, focus };
}

function emptyConfig() {
  return {
    refreshDelayMs: DEFAULT_DELAY_MS,
    defaultView: { ...DEFAULT_VIEW },
    streamMode: 'snapshot',
    realtime: { ...DEFAULT_REALTIME },
    auth: { username: '', password: '' },
    cameras: [],
  };
}

function normalize(raw) {
  const base = emptyConfig();
  if (!raw || typeof raw !== 'object') return base;
  const delay = Number(raw.refreshDelayMs);
  const fps = Number(raw.realtime?.fps);
  const maxWidth = Number(raw.realtime?.maxWidth);
  let defaultView = base.defaultView;
  try { defaultView = parseDefaultView(raw.defaultView); } catch { /* ausente ou inválida: usa o padrão */ }
  return {
    refreshDelayMs: Number.isInteger(delay) && delay >= MIN_DELAY_MS ? delay : base.refreshDelayMs,
    defaultView,
    streamMode: STREAM_MODES.includes(raw.streamMode) ? raw.streamMode : base.streamMode,
    realtime: {
      fps: inRange(fps, FPS_RANGE) ? fps : base.realtime.fps,
      maxWidth: inRange(maxWidth, WIDTH_RANGE) ? maxWidth : base.realtime.maxWidth,
    },
    auth: { username: str(raw.auth?.username), password: String(raw.auth?.password ?? '') },
    cameras: (Array.isArray(raw.cameras) ? raw.cameras : [])
      .filter((c) => c && typeof c.id === 'string' && HOST_RE.test(str(c.ip)))
      .map((c) => ({
        id: c.id,
        name: str(c.name) || str(c.ip),
        ip: str(c.ip),
        username: str(c.username),
        password: String(c.password ?? ''),
        refreshDelayMs: validDelay(Number(c.refreshDelayMs)) ? Number(c.refreshDelayMs) : null,
        streamMode: STREAM_MODES.includes(c.streamMode) ? c.streamMode : null,
        rtspPort: inRange(Number(c.rtspPort), PORT_RANGE) ? Number(c.rtspPort) : null,
      })),
  };
}

export function createConfigStore(file) {
  let data = (() => {
    try {
      return normalize(JSON.parse(readFileSync(file, 'utf8')));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`Config inválida em ${file}, usando padrão:`, err.message);
      return emptyConfig();
    }
  })();

  function save() {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file); // escrita atômica: nunca deixa o JSON pela metade
  }

  const find = (id) => {
    const cam = data.cameras.find((c) => c.id === id);
    if (!cam) throw new ValidationError('Câmera não encontrada', 404);
    return cam;
  };

  function parseCameraInput(input, current) {
    const ip = str(input?.ip);
    if (!HOST_RE.test(ip)) throw new ValidationError('IP inválido (use 192.168.0.10 ou 192.168.0.10:8080)');
    const username = str(input.username);
    const camera = {
      name: str(input.name) || ip,
      ip,
      refreshDelayMs: parseOptionalDelay(input.refreshDelayMs),
      streamMode: parseOptionalMode(input.streamMode),
      rtspPort: parseOptionalPort(input.rtspPort),
      username,
      // Senha vazia em edição = manter a atual; sem usuário não há senha.
      password: !username ? '' : typeof input.password === 'string' && input.password !== ''
        ? input.password
        : (current?.password ?? ''),
    };
    return camera;
  }

  return {
    /** Visão para o navegador: nunca expõe senhas. */
    getPublic() {
      return {
        refreshDelayMs: data.refreshDelayMs,
        defaultView: { ...data.defaultView },
        streamMode: data.streamMode,
        realtime: { ...data.realtime },
        auth: { username: data.auth.username, hasPassword: data.auth.password !== '' },
        // refreshDelayMs/streamMode/rtspPort da câmera: null = usa o global (ou o padrão).
        cameras: data.cameras.map(({ id, name, ip, username, password, refreshDelayMs, streamMode, rtspPort }) => ({
          id, name, ip, username, refreshDelayMs, streamMode, rtspPort, hasPassword: password !== '',
        })),
      };
    },

    getCamera: (id) => find(id),

    getRealtime: () => ({ ...data.realtime }),

    /** Credenciais da câmera, se ela tiver usuário próprio, senão as globais. */
    credentialsFor(cam) {
      return cam.username
        ? { username: cam.username, password: cam.password }
        : { username: data.auth.username, password: data.auth.password };
    },

    updateSettings(input) {
      const delay = Number(input?.refreshDelayMs);
      if (!validDelay(delay)) throw new ValidationError(DELAY_ERROR);
      // Campos de streaming são opcionais: ausentes = mantém o valor atual.
      let streamMode = data.streamMode;
      if (input.streamMode !== undefined) {
        if (!STREAM_MODES.includes(input.streamMode)) throw new ValidationError('Modo de atualização inválido');
        streamMode = input.streamMode;
      }
      const realtime = input.realtime !== undefined ? parseRealtime(input.realtime) : data.realtime;
      const defaultView = input.defaultView !== undefined ? parseDefaultView(input.defaultView) : data.defaultView;

      const username = str(input.auth?.username);
      const password = input.auth?.password;
      data.refreshDelayMs = delay;
      data.streamMode = streamMode;
      data.realtime = realtime;
      data.defaultView = defaultView;
      data.auth.username = username;
      data.auth.password = !username ? '' : typeof password === 'string' && password !== '' ? password : data.auth.password;
      save();
    },

    addCamera(input) {
      let id;
      do { id = randomBytes(4).toString('hex'); } while (data.cameras.some((c) => c.id === id));
      data.cameras.push({ id, ...parseCameraInput(input) });
      save();
      return id;
    },

    updateCamera(id, input) {
      const cam = find(id);
      Object.assign(cam, parseCameraInput(input, cam));
      save();
    },

    removeCamera(id) {
      find(id);
      data.cameras = data.cameras.filter((c) => c.id !== id);
      save();
    },

    reorder(ids) {
      if (!Array.isArray(ids) || ids.length !== data.cameras.length
        || new Set(ids).size !== ids.length || !ids.every((id) => data.cameras.some((c) => c.id === id))) {
        throw new ValidationError('Lista de câmeras inválida para reordenar');
      }
      data.cameras = ids.map((id) => find(id));
      save();
    },
  };
}
