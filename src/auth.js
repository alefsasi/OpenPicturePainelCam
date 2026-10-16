// Senha de acesso às configurações: hash scrypt, sessões por cookie e limite de tentativas.
// Só usa módulos nativos do Node.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export const DEFAULT_PASSWORD = 'admin';
export const MIN_PASSWORD_LENGTH = 6;
export const SESSION_COOKIE = 'painel_session';

const HASH_RE = /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/;
export const isPasswordHash = (value) => typeof value === 'string' && HASH_RE.test(value);

/** Compara sem vazar, pelo tempo, onde as strings diferem. */
export function safeEqual(a, b) {
  const digest = (v) => createHash('sha256').update(String(v)).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(String(password), salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (!isPasswordHash(stored)) return false;
  const [, salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = await scryptAsync(String(password), Buffer.from(salt, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

// ---- Sessões (em memória: reiniciar o painel pede novo login) ------------------------------

export function createSessions({ ttlMs = 12 * 60 * 60 * 1000, max = 100 } = {}) {
  const sessions = new Map(); // token -> expira em

  const prune = () => {
    const now = Date.now();
    for (const [token, expires] of sessions) if (expires <= now) sessions.delete(token);
  };

  return {
    ttlMs,
    create() {
      prune();
      if (sessions.size >= max) sessions.delete(sessions.keys().next().value); // descarta a mais antiga
      const token = randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + ttlMs);
      return token;
    },
    isValid(token) {
      const expires = token ? sessions.get(token) : undefined;
      if (!expires) return false;
      if (expires <= Date.now()) {
        sessions.delete(token);
        return false;
      }
      return true;
    },
    destroy: (token) => sessions.delete(token),
    /** Troca de senha: derruba os outros dispositivos, mantém quem trocou. */
    destroyAllExcept(keep) {
      for (const token of [...sessions.keys()]) if (token !== keep) sessions.delete(token);
    },
  };
}

// ---- Limite de tentativas de login (por endereço) -------------------------------------------

export function createLoginLimiter({ maxFailures = 5, lockMs = 60_000, windowMs = 10 * 60_000 } = {}) {
  const entries = new Map(); // ip -> { failures, since, lockedUntil }

  return {
    /** Segundos até poder tentar de novo (0 = liberado). */
    retryAfter(ip) {
      const entry = entries.get(ip);
      if (!entry) return 0;
      const now = Date.now();
      if (entry.lockedUntil > now) return Math.ceil((entry.lockedUntil - now) / 1000);
      if (now - entry.since > windowMs) entries.delete(ip);
      return 0;
    },
    fail(ip) {
      const now = Date.now();
      let entry = entries.get(ip);
      if (!entry || now - entry.since > windowMs) entry = { failures: 0, since: now, lockedUntil: 0 };
      entry.failures++;
      if (entry.failures >= maxFailures) Object.assign(entry, { failures: 0, since: now, lockedUntil: now + lockMs });
      entries.set(ip, entry);
    },
    success: (ip) => entries.delete(ip),
  };
}

// ---- Cookies --------------------------------------------------------------------------------

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return cookies;
}

/** HttpOnly (o JavaScript da página não lê) e SameSite=Strict (outro site não a envia). */
export function sessionCookie(token, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}
