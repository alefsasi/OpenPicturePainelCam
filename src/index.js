import { createServer } from './server.js';
import { removePidInfo, settings, writePidInfo } from './runtime.js';

// Porta incomum de propósito, para não colidir com 3000/5000/8000/8080 etc.
// Por padrão só aceita conexões locais: a API de configuração não tem login.
// FFmpeg é opcional (só o modo "tempo real" usa).
const { port, host, configPath, ffmpegPath, pidFile } = settings();

const server = createServer({
  configPath,
  ffmpegPath,
  // Parada pedida pela CLI (`stop`): sai pelo caminho normal para encerrar os FFmpeg filhos.
  onShutdown: () => {
    console.log(`[${new Date().toISOString()}] Encerrando por pedido de parada`);
    server.closeAllConnections();
    process.exit(0);
  },
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`A porta ${port} já está em uso. O painel já está rodando? Use "stop" ou defina outra PORT.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  writePidInfo(pidFile, { pid: process.pid, host, port, startedAt: new Date().toISOString() });
  console.log(`[${new Date().toISOString()}] Painel de câmeras em http://${host}:${port} (PID ${process.pid}, config: ${configPath})`);
});

process.on('exit', () => removePidInfo(pidFile, process.pid));
// Ctrl+C / kill: sai pelo caminho normal para encerrar os processos FFmpeg filhos.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
