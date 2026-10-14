// Início automático opcional, sem administrador:
//  - Windows: valor na chave Run do usuário (aparece em Gerenciador de Tarefas > Inicializar)
//  - Linux:   serviço systemd de usuário (+ "linger" para subir no boot, sem ninguém logado)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { appRoot } from './runtime.js';

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_NAME = 'PainelCam';
const UNIT = 'painel-cam.service';

const indexPath = join(appRoot, 'src', 'index.js');
const cliPath = join(appRoot, 'src', 'cli.js');

export const supported = () => process.platform === 'win32' || process.platform === 'linux';
export const label = () => (process.platform === 'win32' ? 'com o Windows' : 'com o sistema');

// ---- Windows ----------------------------------------------------------------------------

/**
 * `start --quiet` só dispara o servidor em segundo plano (sem janela) e termina em instantes.
 * O Node é um programa de console, então uma janela pode piscar por uma fração de segundo
 * no login, enquanto este comando roda; o servidor em si fica escondido.
 */
export function windowsCommand(node = process.execPath, cli = cliPath) {
  return `"${node}" "${cli}" start --quiet`;
}

const reg = (...args) => execFileSync('reg', args, { stdio: 'pipe', windowsHide: true });

// ---- Linux (systemd) --------------------------------------------------------------------

const unitDir = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user');
const systemctl = (...args) => execFileSync('systemctl', ['--user', ...args], { stdio: 'pipe' });

export function systemdUnit(node = process.execPath, index = indexPath, root = appRoot) {
  for (const value of [node, index, root]) {
    if (/[\s"'\\%$]/.test(value)) throw new Error(`Caminho com espaço ou caractere especial não é suportado no serviço systemd: ${value}`);
  }
  return `[Unit]
Description=Painel de Câmeras (Open Picture Painel Cam)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${root}
ExecStart=${node} ${index}
# Reinicia se cair; uma parada pedida com "stop" (saída normal) não reinicia.
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

// ---- API comum --------------------------------------------------------------------------

export function isEnabled() {
  if (process.platform === 'win32') {
    try { reg('query', RUN_KEY, '/v', RUN_NAME); return true; } catch { return false; }
  }
  if (process.platform === 'linux') return existsSync(join(unitDir(), UNIT));
  return false;
}

/** Devolve uma mensagem para mostrar ao usuário; lança Error se não conseguir. */
export function enable() {
  if (process.platform === 'win32') {
    reg('add', RUN_KEY, '/v', RUN_NAME, '/t', 'REG_SZ', '/d', windowsCommand(), '/f');
    return 'Início automático ativado: o painel sobe em segundo plano quando você entrar no Windows.\n'
      + 'Para desligar: "autostart off" ou Gerenciador de Tarefas > Inicializar. Se mover esta pasta, ative de novo.';
  }

  if (process.platform === 'linux') {
    try {
      systemctl('--version');
    } catch {
      throw new Error('systemd não encontrado. Neste sistema, inicie com o init dele o comando:\n'
        + `  ${process.execPath} ${indexPath}`);
    }
    mkdirSync(unitDir(), { recursive: true });
    writeFileSync(join(unitDir(), UNIT), systemdUnit());
    try {
      systemctl('daemon-reload');
      systemctl('enable', UNIT);
    } catch (err) {
      throw new Error(`Não consegui ativar o serviço (${String(err.stderr || err.message).trim()}).\n`
        + 'Em sessão sem systemd de usuário (ex.: su/sudo), entre por SSH/login normal e tente de novo.');
    }

    // Sem "linger" o serviço de usuário só sobe quando o usuário faz login.
    let linger = true;
    try {
      execFileSync('loginctl', ['enable-linger', userInfo().username], { stdio: 'pipe' });
    } catch {
      linger = false;
    }
    return 'Início automático ativado (serviço systemd de usuário "painel-cam").\n'
      + (linger
        ? 'Sobe junto com o sistema, mesmo sem ninguém logado.\n'
        : `Para subir no boot sem ninguém logado, rode uma vez:  sudo loginctl enable-linger ${userInfo().username}\n`)
      + 'Também: systemctl --user start|stop|status painel-cam   |   logs: journalctl --user -u painel-cam';
  }

  throw new Error('Início automático não é suportado neste sistema operacional.');
}

export function disable() {
  if (process.platform === 'win32') {
    try { reg('delete', RUN_KEY, '/v', RUN_NAME, '/f'); } catch { /* já estava desligado */ }
    return 'Início automático desativado.';
  }
  if (process.platform === 'linux') {
    try { systemctl('disable', UNIT); } catch { /* já estava desligado */ }
    rmSync(join(unitDir(), UNIT), { force: true });
    try { systemctl('daemon-reload'); } catch { /* sem systemd de usuário */ }
    return 'Início automático desativado. (O "linger" do usuário não foi alterado.)';
  }
  throw new Error('Início automático não é suportado neste sistema operacional.');
}
