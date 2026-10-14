import { resolve } from 'node:path';
import { createServer } from './server.js';

// Porta incomum de propósito, para não colidir com 3000/5000/8000/8080 etc.
const port = Number(process.env.PORT) || 7391;
// Por padrão só aceita conexões locais: a API de configuração não tem login.
const host = process.env.HOST || '127.0.0.1';
const configPath = resolve(process.env.CONFIG_PATH || 'data/config.json');

createServer({ configPath }).listen(port, host, () => {
  console.log(`Painel de câmeras em http://${host}:${port}  (config: ${configPath})`);
});
