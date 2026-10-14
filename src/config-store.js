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

function emptyConfig() {
  return { refreshDelayMs: DEFAULT_DELAY_MS, auth: { username: '', password: '' }, cameras: [] };
}

function normalize(raw) {
  const base = emptyConfig();
  if (!raw || typeof raw !== 'object') return base;
  const delay = Number(raw.refreshDelayMs);
  return {
    refreshDelayMs: Number.isInteger(delay) && delay >= MIN_DELAY_MS ? delay : base.refreshDelayMs,
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
        auth: { username: data.auth.username, hasPassword: data.auth.password !== '' },
        // refreshDelayMs da câmera: null = usa o global.
        cameras: data.cameras.map(({ id, name, ip, username, password, refreshDelayMs }) => ({
          id, name, ip, username, refreshDelayMs, hasPassword: password !== '',
        })),
      };
    },

    getCamera: (id) => find(id),

    /** Credenciais da câmera, se ela tiver usuário próprio, senão as globais. */
    credentialsFor(cam) {
      return cam.username
        ? { username: cam.username, password: cam.password }
        : { username: data.auth.username, password: data.auth.password };
    },

    updateSettings(input) {
      const delay = Number(input?.refreshDelayMs);
      if (!validDelay(delay)) throw new ValidationError(DELAY_ERROR);
      const username = str(input.auth?.username);
      const password = input.auth?.password;
      data.refreshDelayMs = delay;
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
