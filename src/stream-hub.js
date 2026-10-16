// Tempo real: converte o RTSP do sub-stream da câmera em JPEGs usando FFmpeg.
//
// - Um único processo FFmpeg por câmera, compartilhado por todos os espectadores.
// - O processo só existe enquanto houver alguém assistindo (encerra após `idleMs`).
// - Se cair ou travar, reinicia com backoff enquanto ainda houver espectadores.
// - FFmpeg é um binário externo e opcional: sem ele o painel segue em modo snapshot.
import { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createJpegSplitter } from './jpeg-splitter.js';
import { AUTH_PAUSE_MS } from './camera-client.js';

const AUTH_ERROR = 'Usuário ou senha inválidos';
const isAuthError = (stderr) => /401|unauthorized/i.test(stderr);
// A URL carrega as credenciais: guardamos só um hash para lembrar "esta combinação foi recusada".
const urlKey = (url) => createHash('sha256').update(url).digest('hex');

// 102 = sub-stream do canal 1 (o mesmo canal usado pelo /picture).
export const RTSP_PATH = '/Streaming/Channels/102';
export const DEFAULT_RTSP_PORT = 554;

// Garante que nenhum FFmpeg fique órfão se o servidor morrer.
const children = new Set();
process.once('exit', () => { for (const child of children) child.kill('SIGKILL'); });

/** O `ip` da câmera pode trazer a porta HTTP (192.168.0.10:8080); o RTSP usa a sua própria. */
const hostOf = (ip) => ip.replace(/:\d{1,5}$/, '');

export function buildRtspUrl({ ip, rtspPort }, { username, password }) {
  const auth = username ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';
  return `rtsp://${auth}${hostOf(ip)}:${rtspPort ?? DEFAULT_RTSP_PORT}${RTSP_PATH}`;
}

/** Argumentos de baixa latência: sem buffer, sem áudio, fps e largura limitados. */
export function ffmpegArgs({ url, fps, width }) {
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-rtsp_transport', 'tcp',
    '-fflags', 'nobuffer+discardcorrupt', '-flags', 'low_delay',
    '-probesize', '65536', '-analyzeduration', '500000',
    '-i', url,
    '-an', '-sn',
    '-vf', `fps=${fps},scale='min(${width},iw)':-2`, // nunca aumenta a imagem
    '-c:v', 'mjpeg', '-q:v', '6', '-pix_fmt', 'yuvj420p',
    '-flush_packets', '1',
    '-f', 'image2pipe', 'pipe:1',
  ];
}

// A URL carrega usuário e senha: nunca deixe isso vazar em mensagens de erro.
const redact = (text) => text.replace(/rtsp:\/\/[^@\s]*@/gi, 'rtsp://***@');

function classifyError(stderr) {
  if (isAuthError(stderr)) return AUTH_ERROR;
  if (/404|stream not found/i.test(stderr)) return 'Stream RTSP não encontrado na câmera';
  if (/refused|timed out|timeout|unreachable|no route|reset by peer|network is down/i.test(stderr)) {
    return 'Falha ao conectar na câmera (RTSP)';
  }
  const last = redact(stderr.trim().split('\n').pop() ?? '').slice(0, 160);
  return last || 'O FFmpeg encerrou inesperadamente';
}

export function createStreamHub({
  ffmpegPath = 'ffmpeg',
  spawn = nodeSpawn,
  idleMs = 5000, // quanto esperar após o último espectador sair antes de matar o processo
  stallMs = 10_000, // sem quadros por esse tempo = processo travado
  maxStreams = 16,
  probeTimeoutMs = 5000, // tempo máximo para `ffmpeg -version` responder
  retryBaseMs = 1000,
  retryMaxMs = 10_000,
  authPauseMs = AUTH_PAUSE_MS, // sem novas tentativas depois que a câmera recusa usuário/senha
} = {}) {
  const streams = new Map();
  // Credenciais já recusadas -> até quando não tentamos de novo. Câmeras Hikvision bloqueiam
  // o login por ~30 min depois de poucas tentativas erradas, então nunca insistimos.
  const rejected = new Map();
  let available = false;

  // Descobre uma vez se o FFmpeg existe e roda.
  const ready = new Promise((resolve) => {
    let settled = false;
    let timeout = null;
    const finish = (ok) => {
      if (settled) return; // só o primeiro resultado vale (o timeout não pode desfazer um sucesso)
      settled = true;
      clearTimeout(timeout);
      available = ok;
      resolve(ok);
    };
    try {
      const probe = spawn(ffmpegPath, ['-version'], { stdio: 'ignore', windowsHide: true });
      probe.once('error', () => finish(false));
      probe.once('exit', (code) => finish(code === 0));
      timeout = setTimeout(() => { probe.kill(); finish(false); }, probeTimeoutMs);
      timeout.unref();
    } catch {
      finish(false);
    }
  });

  function createStream(id, resolveSource) {
    const listeners = new Set();
    let proc = null; // { child, restart, reason }
    let stallTimer = null;
    let retryTimer = null;
    let idleTimer = null;
    let failures = 0;
    let lastFrame = null;
    let lastFrameAt = 0;
    let lastError = null;
    let fatal = false; // erro sem retry automático (FFmpeg ausente, câmera removida, senha recusada): só reset() destrava
    let sourceKey = null; // hash da URL (com credenciais) em uso
    let live = false;

    const emit = (fn) => {
      for (const l of [...listeners]) {
        try { fn(l); } catch { /* um ouvinte com defeito não derruba os outros */ }
      }
    };

    function fail(message, { fatal: isFatal = false } = {}) {
      lastError = message;
      fatal = isFatal;
      emit((l) => l.onStatus('error', message));
      if (isFatal || !listeners.size) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(start, Math.min(retryMaxMs, retryBaseMs * 2 ** Math.max(0, failures - 1)));
      retryTimer.unref();
    }

    function start() {
      clearTimeout(retryTimer);
      retryTimer = null;
      if (proc || !listeners.size) return;

      let source;
      try {
        source = resolveSource();
      } catch (err) {
        return fail(err.message, { fatal: true }); // ex.: câmera removida
      }

      sourceKey = urlKey(source.url);
      const pausedUntil = rejected.get(sourceKey) ?? 0;
      if (pausedUntil > Date.now()) {
        const minutes = Math.ceil((pausedUntil - Date.now()) / 60_000);
        return fail(`${AUTH_ERROR}. Tentativas pausadas por ${minutes} min para a câmera não bloquear`, { fatal: true });
      }
      rejected.delete(sourceKey);

      const run = { child: null, restart: false, reason: null, intentional: false };
      let stderr = '';
      const armStall = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          run.reason = 'Sem imagem da câmera (tempo esgotado)';
          run.child.kill();
        }, stallMs);
        stallTimer.unref();
      };

      let child;
      try {
        child = spawn(ffmpegPath, ffmpegArgs(source), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      } catch (err) {
        return fail(`Não foi possível iniciar o FFmpeg (${err.code ?? err.message})`, { fatal: true });
      }
      run.child = child;
      proc = run;
      children.add(child);
      armStall();

      const split = createJpegSplitter((frame) => {
        lastFrame = frame;
        lastFrameAt = Date.now();
        armStall();
        if (!live) {
          live = true;
          failures = 0;
          lastError = null;
          emit((l) => l.onStatus('live'));
        }
        emit((l) => l.onFrame(frame));
      });
      child.stdout.on('data', split);
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4096); });

      child.once('error', (err) => {
        children.delete(child);
        clearTimeout(stallTimer);
        if (proc === run) proc = null;
        if (err.code === 'ENOENT') {
          available = false;
          return fail('FFmpeg não encontrado no servidor', { fatal: true });
        }
        failures++;
        fail(`Falha ao executar o FFmpeg (${err.code ?? err.message})`);
      });

      child.once('exit', () => {
        children.delete(child);
        clearTimeout(stallTimer);
        if (proc === run) proc = null;
        if (run.intentional) {
          if (run.restart && listeners.size) start();
          return;
        }
        live = false;
        lastFrame = null;
        if (!run.reason && isAuthError(stderr)) {
          // Senha recusada: tentar de novo só piora (bloqueio da câmera). Para até alguém corrigir.
          rejected.set(sourceKey, Date.now() + authPauseMs);
          return fail(AUTH_ERROR, { fatal: true });
        }
        failures++;
        fail(run.reason ?? classifyError(stderr));
      });
    }

    function killProc(restart = false) {
      if (!proc) return;
      proc.intentional = true;
      proc.restart = restart;
      proc.child.kill();
    }

    function destroy() {
      clearTimeout(idleTimer);
      clearTimeout(retryTimer);
      clearTimeout(stallTimer);
      killProc();
      streams.delete(id);
    }

    return {
      add(listener) {
        listeners.add(listener);
        clearTimeout(idleTimer);
        if (live && lastFrame && Date.now() - lastFrameAt < 3000) {
          listener.onStatus('live');
          listener.onFrame(lastFrame); // primeira imagem imediata para quem entrou agora
        } else if (lastError) {
          listener.onStatus('error', lastError);
        }
        if (!proc && !retryTimer && !fatal) start();
      },

      remove(listener) {
        listeners.delete(listener);
        if (!listeners.size) {
          idleTimer = setTimeout(destroy, idleMs);
          idleTimer.unref();
        }
      },

      /** Aplica configuração nova: reinicia agora (ou só inicia, se estava parado). */
      reset() {
        failures = 0;
        lastError = null;
        fatal = false;
        if (sourceKey) rejected.delete(sourceKey); // salvar a configuração libera uma nova tentativa
        clearTimeout(retryTimer);
        retryTimer = null;
        if (proc) killProc(true);
        else start();
      },

      destroy,
    };
  }

  return {
    ready,
    get available() { return available; },

    /**
     * Assina os quadros de uma câmera. `resolveSource()` devolve { url, fps, width }
     * e é chamada a cada (re)início, então sempre pega a configuração atual.
     * `listener` = { onFrame(buffer), onStatus('live' | 'error', mensagem?) }.
     * Devolve a função de cancelar a assinatura.
     */
    subscribe(id, resolveSource, listener) {
      let stream = streams.get(id);
      if (!stream) {
        if (streams.size >= maxStreams) throw new Error('Limite de streams simultâneos atingido');
        stream = createStream(id, resolveSource);
        streams.set(id, stream);
      }
      stream.add(listener);
      return () => stream.remove(listener);
    },

    reset: (id) => streams.get(id)?.reset(),
    resetAll: () => streams.forEach((s) => s.reset()),
    closeAll: () => [...streams.values()].forEach((s) => s.destroy()),
  };
}
