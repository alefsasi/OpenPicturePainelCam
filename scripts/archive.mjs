// Leitura e escrita mínimas de ZIP e TAR.GZ usando só `zlib` do Node.
// Evita depender de `zip`/`tar`/`unzip` do sistema e permite definir o modo de
// execução (0755) dos arquivos mesmo quando o pacote Linux é gerado no Windows.
import { deflateRawSync, gunzipSync, gzipSync, inflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- ZIP ------------------------------------------------------------------------------

/** entries: [{ name, data: Buffer, mode?: 0o644 }] -> Buffer do .zip */
export function createZip(entries, date = new Date()) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  if (entries.length > 0xffff) throw new Error('ZIP com arquivos demais');

  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, data, mode = 0o644 } of entries) {
    if (data.length > 0xffffffff) throw new Error(`Arquivo grande demais para ZIP simples: ${name}`);
    const nameBuf = Buffer.from(name);
    const packed = deflateRawSync(data, { level: 6 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4); // criado em "Unix": o modo abaixo é respeitado
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38); // atributos externos: arquivo regular + permissões
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);

    offset += local.length + nameBuf.length + packed.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/** Extrai um arquivo pelo nome de dentro de um .zip em memória (ou null). */
export function readZipEntry(zip, wanted) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('ZIP inválido (sem diretório central)');

  const count = zip.readUInt16LE(end + 10);
  let pos = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) throw new Error('ZIP inválido (diretório central corrompido)');
    const method = zip.readUInt16LE(pos + 10);
    const packedSize = zip.readUInt32LE(pos + 20);
    const nameLength = zip.readUInt16LE(pos + 28);
    const extraLength = zip.readUInt16LE(pos + 30);
    const commentLength = zip.readUInt16LE(pos + 32);
    const localOffset = zip.readUInt32LE(pos + 42);
    const name = zip.toString('utf8', pos + 46, pos + 46 + nameLength);

    if (name === wanted) {
      const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
      const packed = zip.subarray(start, start + packedSize);
      if (method === 0) return Buffer.from(packed);
      if (method === 8) return inflateRawSync(packed);
      throw new Error(`Método de compressão ZIP não suportado: ${method}`);
    }
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

// ---- TAR.GZ ---------------------------------------------------------------------------

const octal = (buffer, value, offset, length) => buffer.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset);
const cString = (buffer, start, end) => buffer.toString('utf8', start, end).replace(/\0[\s\S]*$/, '');

/** entries: [{ name, data: Buffer, mode?: 0o644 }] -> Buffer do .tar.gz (formato ustar) */
export function createTarGz(entries, mtime = Math.floor(Date.now() / 1000)) {
  const blocks = [];
  for (const { name, data, mode = 0o644 } of entries) {
    if (Buffer.byteLength(name) > 100) throw new Error(`Caminho longo demais para o tar: ${name}`);
    const header = Buffer.alloc(512);
    header.write(name, 0);
    octal(header, mode & 0o7777, 100, 8);
    octal(header, 0, 108, 8); // uid
    octal(header, 0, 116, 8); // gid
    octal(header, data.length, 124, 12);
    octal(header, mtime, 136, 12);
    header.fill(0x20, 148, 156); // checksum calculado com este campo em branco
    header.write('0', 156); // arquivo regular
    header.write('ustar\0', 257);
    header.write('00', 263);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024)); // fim do arquivo
  return gzipSync(Buffer.concat(blocks), { level: 6 });
}

/** Extrai um arquivo pelo nome de dentro de um .tar.gz em memória (ou null). */
export function readTarGzEntry(tarGz, wanted) {
  const tar = gunzipSync(tarGz);
  let pos = 0;
  while (pos + 512 <= tar.length) {
    const header = tar.subarray(pos, pos + 512);
    if (header.every((b) => b === 0)) break;
    let name = cString(header, 0, 100);
    if (header.toString('latin1', 257, 262) === 'ustar') {
      const prefix = cString(header, 345, 500);
      if (prefix) name = `${prefix}/${name}`;
    }
    const size = parseInt(cString(header, 124, 136).trim(), 8);
    const type = String.fromCharCode(header[156]);
    pos += 512;
    if ((type === '0' || type === '\0') && name === wanted) return Buffer.from(tar.subarray(pos, pos + size));
    pos += Math.ceil(size / 512) * 512;
  }
  return null;
}
