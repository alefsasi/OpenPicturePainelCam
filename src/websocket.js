// Servidor WebSocket mínimo (RFC 6455), sem dependências.
// Suporta só o necessário: mensagens de texto pequenas vindas do navegador,
// ping/pong/close e envio de texto/binário para o cliente.
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 64 * 1024;
const PING_MS = 20_000;
const DEAD_MS = 60_000;

const OP = { TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

function frameHeader(opcode, length) {
  if (length < 126) return Buffer.from([0x80 | opcode, length]);
  if (length < 65536) {
    const h = Buffer.alloc(4);
    h[0] = 0x80 | opcode;
    h[1] = 126;
    h.writeUInt16BE(length, 2);
    return h;
  }
  const h = Buffer.alloc(10);
  h[0] = 0x80 | opcode;
  h[1] = 127;
  h.writeBigUInt64BE(BigInt(length), 2);
  return h;
}

class Connection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.closed = false;
    this.closing = false;
    this.pending = Buffer.alloc(0);
    this.lastSeen = Date.now();

    socket.setNoDelay(true);
    socket.on('data', (chunk) => {
      if (this.closing) return;
      this.lastSeen = Date.now();
      this.pending = Buffer.concat([this.pending, chunk]);
      this.#parse();
    });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      this.closed = true;
      clearInterval(this.heartbeat);
      this.emit('close');
    });

    // Detecta clientes que sumiram sem fechar a conexão (notebook suspenso, rede caiu).
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastSeen > DEAD_MS) return socket.destroy();
      this.#send(OP.PING, Buffer.alloc(0));
    }, PING_MS);
    this.heartbeat.unref();
  }

  /** Bytes ainda não enviados ao cliente: quem consome use para descartar quadros. */
  get buffered() {
    return this.socket.writableLength;
  }

  #send(opcode, ...parts) {
    if (this.closed || this.socket.destroyed) return;
    const length = parts.reduce((sum, p) => sum + p.length, 0);
    this.socket.cork(); // cabeçalho + corpo saem juntos, sem copiar o JPEG
    this.socket.write(frameHeader(opcode, length));
    for (const part of parts) this.socket.write(part);
    this.socket.uncork();
  }

  sendText(text) {
    this.#send(OP.TEXT, Buffer.from(text));
  }

  sendBinary(...parts) {
    this.#send(OP.BINARY, ...parts);
  }

  close(code = 1000) {
    if (this.closed || this.closing) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code);
    this.#send(OP.CLOSE, payload);
    this.closing = true;
    this.socket.end();
  }

  #parse() {
    while (this.pending.length >= 2) {
      const [b0, b1] = this.pending;
      const fin = b0 & 0x80;
      const opcode = b0 & 0x0f;
      let length = b1 & 0x7f;
      let offset = 2;

      if (!(b1 & 0x80)) return this.close(1002); // o cliente é obrigado a mascarar
      if (length === 126) {
        if (this.pending.length < 4) return;
        length = this.pending.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        return this.close(1009);
      }
      if (length > MAX_MESSAGE) return this.close(1009);
      if (this.pending.length < offset + 4 + length) return;

      const mask = this.pending.subarray(offset, offset + 4);
      const payload = Buffer.from(this.pending.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.pending = this.pending.subarray(offset + 4 + length);

      if (!fin || opcode === 0) return this.close(1003); // fragmentação não suportada
      if (opcode === OP.TEXT) this.emit('message', payload.toString('utf8'));
      else if (opcode === OP.PING) this.#send(OP.PONG, payload);
      else if (opcode === OP.CLOSE) return this.close();
      // PONG e BINARY do cliente: ignorados (lastSeen já foi atualizado)
    }
  }
}

/**
 * Atende `Upgrade: websocket` em `path` e chama onConnection(conn).
 * Recusa origens diferentes do Host, o que impede que outro site aberto no
 * navegador (CSWSH) assista às câmeras por este servidor.
 */
export function attachWebSocket(server, path, onConnection) {
  server.on('upgrade', (req, socket) => {
    const reject = (status, text) => socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
    const key = req.headers['sec-websocket-key'];

    let pathname;
    try {
      ({ pathname } = new URL(req.url, 'http://localhost'));
    } catch {
      return reject(400, 'Bad Request');
    }
    if (pathname !== path) return reject(404, 'Not Found');
    if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
      return reject(400, 'Bad Request');
    }
    const { origin } = req.headers;
    if (origin) {
      let originHost = null;
      try { originHost = new URL(origin).host; } catch { /* origem inválida */ }
      if (originHost !== req.headers.host) return reject(403, 'Forbidden');
    }

    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '', '',
    ].join('\r\n'));
    onConnection(new Connection(socket), req);
  });
}
