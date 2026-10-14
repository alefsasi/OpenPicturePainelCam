// CLI do painel: rodar em segundo plano, parar, ver o estado e ligar o início automático.
//   node src/cli.js [comando]      (ou start.bat / start.sh / painel-cam com o mesmo comando)
import { execFile, spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import * as autostart from './autostart.js';
import { appRoot, baseUrl, isAlive, ping, readPidInfo, requestShutdown, rotateLog, settings } from './runtime.js';

const HELP = `Painel de Câmeras

Uso: painel.bat [comando]   (Windows)      ./start.sh [comando]   (Linux)

  (sem comando)    roda em primeiro plano, preso a esta janela (Ctrl+C para parar)
  start            roda em segundo plano, sem janela
  stop             para o painel (--force encerra o processo à força)
  status           mostra se está rodando
  open             abre o painel no navegador
  autostart on     liga o início automático (off desliga, status mostra)
  menu             menu interativo
  logs             mostra o final do arquivo de log

Porta e endereço: defina PORT/HOST ou escreva-os em data/painel.env.`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { port: defaultPort, host: defaultHost, pidFile, logFile } = settings();

function tailLog(lines = 15) {
  try {
    return readFileSync(logFile, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '(sem log)';
  }
}

/** Instância em execução: { info, url } ou null (limpa um registro antigo que sobrou). */
async function running() {
  const info = readPidInfo(pidFile);
  if (!info) return null;
  if (!isAlive(info.pid)) return null;
  const pong = await ping(info);
  return pong?.pid === info.pid ? { info, url: baseUrl(info) } : { info, url: baseUrl(info), unresponsive: true };
}

async function start({ quiet = false } = {}) {
  const current = await running();
  if (current && !current.unresponsive) {
    console.log(`Já está rodando: ${current.url} (PID ${current.info.pid})`);
    return 0;
  }
  if (current?.unresponsive) {
    console.error(`Existe um processo (PID ${current.info.pid}) registrado mas que não responde. Use "stop --force" e tente de novo.`);
    return 1;
  }

  mkdirSync(dirname(logFile), { recursive: true });
  rotateLog(logFile);
  const log = openSync(logFile, 'a');
  // detached + windowsHide: o servidor vive sozinho, sem janela e sem prender este terminal.
  const child = spawn(process.execPath, [join(appRoot, 'src', 'index.js')], {
    cwd: appRoot,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  child.unref();

  if (quiet) return 0;

  let exitCode = null;
  child.once('exit', (code) => { exitCode = code ?? 1; });
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    const now = await running();
    if (now && !now.unresponsive) {
      console.log(`Painel rodando em segundo plano: ${now.url} (PID ${now.info.pid})`);
      console.log('Para parar: stop    Log: data/painel.log');
      return 0;
    }
    if (exitCode !== null) break;
  }
  console.error(`O painel não iniciou. Final do log (${logFile}):\n${tailLog()}`);
  return 1;
}

async function stop({ force = false } = {}) {
  const info = readPidInfo(pidFile);
  if (!info || !isAlive(info.pid)) {
    console.log('O painel não está rodando.');
    return 0;
  }

  const pong = await ping(info);
  if (pong?.pid === info.pid) {
    try { await requestShutdown(info); } catch { /* cai para a parada à força abaixo */ }
    for (let i = 0; i < 25 && isAlive(info.pid); i++) await sleep(200);
    if (!isAlive(info.pid)) {
      console.log('Painel parado.');
      return 0;
    }
  } else if (!force) {
    console.error(`O processo ${info.pid} existe mas não respondeu como o painel (travado, ou o PID foi reaproveitado).`);
    console.error('Se tiver certeza, encerre à força com: stop --force');
    return 1;
  }

  try {
    process.kill(info.pid, 'SIGKILL');
    console.log(`Painel encerrado à força (PID ${info.pid}).`);
    return 0;
  } catch (err) {
    console.error(`Não consegui encerrar o PID ${info.pid}: ${err.message}`);
    return 1;
  }
}

async function status() {
  const current = await running();
  if (!current) {
    console.log('Parado.');
  } else if (current.unresponsive) {
    console.log(`Processo ${current.info.pid} existe mas não responde (${current.url}).`);
  } else {
    console.log(`Rodando: ${current.url} (PID ${current.info.pid}, desde ${current.info.startedAt})`);
  }
  if (autostart.supported()) {
    console.log(`Início automático ${autostart.label()}: ${autostart.isEnabled() ? 'ligado' : 'desligado'}`);
  }
  return current && !current.unresponsive ? 0 : 1;
}

function openBrowser(url) {
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    console.log(`Sem interface gráfica neste computador. Acesse ${url} de um navegador.`);
    return;
  }
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(cmd, args, { windowsHide: true }, (err) => {
    if (err) console.log(`Não consegui abrir o navegador. Acesse: ${url}`);
  });
}

async function open() {
  const current = await running();
  openBrowser(current?.url ?? baseUrl({ host: defaultHost, port: defaultPort }));
  return 0;
}

async function toggleAutostart(action) {
  if (!autostart.supported()) {
    console.error('Início automático não é suportado neste sistema operacional.');
    return 1;
  }
  try {
    if (action === 'on') console.log(autostart.enable());
    else if (action === 'off') console.log(autostart.disable());
    else if (action === 'status' || !action) console.log(`Início automático ${autostart.label()}: ${autostart.isEnabled() ? 'ligado' : 'desligado'}`);
    else { console.error('Use: autostart on | off | status'); return 1; }
    return 0;
  } catch (err) {
    console.error(err.message);
    return 1;
  }
}

async function menu() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on('close', () => { closed = true; }); // entrada encerrada (Ctrl+D/Ctrl+Z, pipe): sai do menu
  try {
    for (;;) {
      if (closed) return 0;
      const current = await running();
      console.log(`\n=== Painel de Câmeras ===`);
      console.log(current ? `Rodando em ${current.url} (PID ${current.info.pid})` : 'Parado');
      if (autostart.supported()) console.log(`Início automático ${autostart.label()}: ${autostart.isEnabled() ? 'ligado' : 'desligado'}`);
      console.log('\n  1) Iniciar em segundo plano\n  2) Parar\n  3) Abrir no navegador');
      if (autostart.supported()) console.log('  4) Ligar início automático\n  5) Desligar início automático');
      console.log('  0) Sair\n');

      if (closed) return 0;
      const choice = (await rl.question('Escolha: ').catch(() => '0')).trim();
      if (choice === '0' || choice === '') return 0;
      if (choice === '1') await start();
      else if (choice === '2') await stop();
      else if (choice === '3') await open();
      else if (choice === '4') await toggleAutostart('on');
      else if (choice === '5') await toggleAutostart('off');
    }
  } finally {
    rl.close();
  }
}

const [command = 'run', ...args] = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);

const commands = {
  start: () => start({ quiet: flag('quiet') }),
  stop: () => stop({ force: flag('force') }),
  status,
  open,
  menu,
  logs: async () => { console.log(tailLog(40)); return 0; },
  autostart: () => toggleAutostart(args[0]),
  help: async () => { console.log(HELP); return 0; },
};

if (command === 'run') {
  await import('./index.js'); // primeiro plano: o servidor mantém o processo vivo
} else if (commands[command]) {
  process.exitCode = await commands[command]();
} else {
  console.error(`Comando desconhecido: ${command}\n\n${HELP}`);
  process.exitCode = 1;
}

