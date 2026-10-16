// Busca o snapshot JPEG de uma câmera Hikvision (ISAPI) com autenticação
// Digest (padrão das câmeras) ou Basic. Sem dependências: usa fetch + crypto.
import { createHash, randomBytes } from 'node:crypto';

export const PICTURE_PATH = '/ISAPI/Streaming/channels/102/picture';
const MAX_BYTES = 8 * 1024 * 1024;

// Tempo sem tentar de novo depois que a câmera recusa usuário/senha.
export const AUTH_PAUSE_MS = 10 * 60_000;

/** Identifica a senha sem guardá-la em memória solta (usado só como chave de comparação). */
export const credentialsFingerprint = (password) => createHash('sha256').update(String(password)).digest('hex').slice(0, 16);

const HASHES = { 'MD5': 'md5', 'SHA-256': 'sha256' };
const hash = (algo, s) => createHash(HASHES[algo]).update(s).digest('hex');

export class CameraError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export function parseDigestChallenge(header) {
  const at = header?.search(/digest\s/i) ?? -1;
  if (at < 0) return null;
  const params = {};
  for (const m of header.slice(at + 7).matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)) {
    params[m[1].toLowerCase()] = m[2] ?? m[3];
  }
  if (!params.realm || !params.nonce) return null;
  const algorithm = (params.algorithm ?? 'MD5').toUpperCase();
  if (!HASHES[algorithm]) throw new CameraError(`Algoritmo Digest não suportado: ${algorithm}`);
  const qop = params.qop?.split(',').map((q) => q.trim()).includes('auth') ? 'auth' : null;
  return { realm: params.realm, nonce: params.nonce, opaque: params.opaque, algorithm, qop, nc: 0 };
}

export function digestAuthorization(challenge, { username, password, method, uri, cnonce = randomBytes(8).toString('hex') }) {
  const { realm, nonce, opaque, algorithm, qop } = challenge;
  const h = (s) => hash(algorithm, s);
  const ha1 = h(`${username}:${realm}:${password}`);
  const ha2 = h(`${method}:${uri}`);
  const nc = (++challenge.nc).toString(16).padStart(8, '0');
  const response = qop
    ? h(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : h(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `username="${username}"`, `realm="${realm}"`, `nonce="${nonce}"`, `uri="${uri}"`,
    `algorithm=${algorithm}`, `response="${response}"`,
  ];
  if (opaque) parts.push(`opaque="${opaque}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(', ')}`;
}

/**
 * Cliente com cache do desafio Digest por câmera: depois da primeira
 * requisição cada snapshot custa apenas 1 round-trip (o nonce é reaproveitado
 * até a câmera responder 401 de novo).
 */
export function createCameraClient({ timeoutMs = 5000, authPauseMs = AUTH_PAUSE_MS } = {}) {
  const challenges = new Map(); // "host|user" -> desafio Digest | { basic: true }
  // Credenciais que a câmera já recusou -> até quando ficamos sem tentar de novo.
  // A chave inclui um hash da senha, então corrigir a senha no painel libera na hora.
  const rejected = new Map();
  const rejectionKey = (ip, { username, password }) => `${ip}|${username}|${credentialsFingerprint(password)}`;

  async function request(url, authorization, signal) {
    const res = await fetch(url, {
      headers: authorization ? { Authorization: authorization } : {},
      signal,
    });
    return res;
  }

  function authorize(entry, { username, password }, uri) {
    if (!entry) return undefined;
    if (entry.basic) return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    return digestAuthorization(entry, { username, password, method: 'GET', uri });
  }

  async function fetchSnapshot({ ip }, credentials, { signal, force = false } = {}) {
    const url = `http://${ip}${PICTURE_PATH}`;
    const key = `${ip}|${credentials.username}`;

    // Câmeras Hikvision bloqueiam o login (~30 min) após poucas tentativas erradas.
    // Por isso, depois de uma recusa, não insistimos com as mesmas credenciais.
    const blockedKey = rejectionKey(ip, credentials);
    const blockedUntil = rejected.get(blockedKey) ?? 0;
    if (!force && blockedUntil > Date.now()) {
      const minutes = Math.ceil((blockedUntil - Date.now()) / 60_000);
      throw new CameraError(`Usuário ou senha inválidos. Tentativas pausadas por ${minutes} min para a câmera não bloquear`, 401);
    }
    rejected.delete(blockedKey);
    const timeout = AbortSignal.timeout(timeoutMs);
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;

    try {
      let res = await request(url, authorize(challenges.get(key), credentials, PICTURE_PATH), sig);

      if (res.status === 401) {
        const header = res.headers.get('www-authenticate');
        await res.body?.cancel();
        if (!credentials.username) throw new CameraError('A câmera exige usuário e senha', 401);
        const challenge = parseDigestChallenge(header) ?? (/basic/i.test(header ?? '') ? { basic: true } : null);
        if (!challenge) throw new CameraError('Método de autenticação não suportado pela câmera');
        challenges.set(key, challenge);
        res = await request(url, authorize(challenge, credentials, PICTURE_PATH), sig);
        if (res.status === 401) {
          await res.body?.cancel();
          challenges.delete(key);
          rejected.set(blockedKey, Date.now() + authPauseMs);
          throw new CameraError('Usuário ou senha inválidos', 401);
        }
      }

      if (!res.ok) {
        await res.body?.cancel();
        throw new CameraError(`A câmera respondeu HTTP ${res.status}`);
      }
      const type = res.headers.get('content-type') ?? 'image/jpeg';
      if (!type.startsWith('image/')) {
        await res.body?.cancel();
        throw new CameraError('A câmera não devolveu uma imagem');
      }
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > MAX_BYTES) throw new CameraError('Imagem grande demais');
      return { body, type };
    } catch (err) {
      if (err instanceof CameraError) throw err;
      if (timeout.aborted) throw new CameraError('Tempo esgotado ao falar com a câmera', 504);
      if (signal?.aborted) throw new CameraError('Requisição cancelada', 499);
      throw new CameraError(`Falha ao conectar na câmera (${err.cause?.code ?? err.message})`);
    }
  }

  return { fetchSnapshot };
}
