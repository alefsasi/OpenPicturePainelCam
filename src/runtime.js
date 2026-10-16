// Configuração de execução compartilhada pelo servidor (index.js) e pela CLI (cli.js):
// onde ficam config/PID/log e como descobrir se o painel já está rodando.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ID = 'open-picture-painel-cam';
export const DEFAULT_PORT = 7391;
export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Lê linhas CHAVE=valor (comentários com #, aspas opcionais). */
export function parseEnvFile(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const eq = line.indexOf('=');
    if (!line || line.startsWith('#') || eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    values[line.slice(0, eq).trim()] = value;
  }
  return values;
}

// Arquivo opcional data/painel.env: deixa PORT/HOST/FFMPEG_PATH fixos sem mexer nas variáveis
// do sistema (serve igual no Windows, no systemd e no início automático). Variáveis de ambiente
// de verdade vencem o arquivo. CONFIG_PATH fica de fora: ele define onde esse arquivo mora.
export const ENV_FILE = join(appRoot, 'data', 'painel.env');

function setting(name) {
  if (process.env[name]) return process.env[name];
  try {
    return parseEnvFile(readFileSync(ENV_FILE, 'utf8'))[name] || undefined;
  } catch {
    return undefined; // arquivo ausente
  }
}

/** FFmpeg: configuração explícita, senão o que estiver em runtime/ (pacote de release), senão o do PATH. */
function ffmpegPath() {
  const explicit = setting('FFMPEG_PATH');
  if (explicit) return explicit;
  const bundled = join(appRoot, 'runtime', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return existsSync(bundled) ? bundled : 'ffmpeg';
}

/**
 * Caminhos relativos valem a partir da pasta do programa, não do diretório atual:
 * a CLI pode ser chamada de qualquer lugar (atalho no PATH, início automático...).
 */
export function settings() {
  const configPath = resolve(appRoot, process.env.CONFIG_PATH || 'data/config.json');
  return {
    port: Number(setting('PORT')) || DEFAULT_PORT,
    host: setting('HOST') || '127.0.0.1',
    configPath,
    ffmpegPath: ffmpegPath(),
    pidFile: join(dirname(configPath), 'painel.pid'),
    logFile: join(dirname(configPath), 'painel.log'),
  };
}

// ---- Arquivo de PID -------------------------------------------------------------------

export function writePidInfo(file, info) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(info));
}

export function readPidInfo(file) {
  try {
    const info = JSON.parse(readFileSync(file, 'utf8'));
    return Number.isInteger(info.pid) && Number.isInteger(info.port) ? info : null;
  } catch {
    return null;
  }
}

/** Só apaga se o arquivo ainda for desta instância (outra pode ter assumido o lugar). */
export function removePidInfo(file, pid) {
  if (readPidInfo(file)?.pid === pid) {
    try { unlinkSync(file); } catch { /* já removido */ }
  }
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // existe, mas é de outro usuário
  }
}

export function rotateLog(file, maxBytes = 1024 * 1024) {
  try {
    if (statSync(file).size > maxBytes) renameSync(file, `${file}.1`);
  } catch { /* sem log ainda */ }
}

// ---- Falando com uma instância em execução ----------------------------------------------

/** 0.0.0.0 / :: não são endereços de destino: conectamos pelo loopback. */
export function baseUrl({ host, port }) {
  const target = host === '0.0.0.0' || host === '::' || !host ? '127.0.0.1' : host;
  return `http://${target.includes(':') ? `[${target}]` : target}:${port}`;
}

/** Devolve { app, pid } se for mesmo o painel respondendo, senão null. */
export async function ping(info, timeoutMs = 1500) {
  try {
    const res = await fetch(`${baseUrl(info)}/api/ping`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.json();
    return body?.app === APP_ID ? body : null;
  } catch {
    return null;
  }
}

/** Pedido da CLI a uma instância no mesmo computador (o servidor exige loopback e o PID certo). */
export async function postLocal(info, path, timeoutMs = 3000) {
  const res = await fetch(`${baseUrl(info)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pid: info.pid }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.ok;
}

export const requestShutdown = (info, timeoutMs) => postLocal(info, '/api/shutdown', timeoutMs);
