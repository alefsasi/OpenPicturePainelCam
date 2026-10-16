import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { crc32, createTarGz, createZip, readTarGzEntry, readZipEntry } from '../scripts/archive.mjs';

const files = [
  { name: 'app/a.txt', data: Buffer.from('olá, mundo '.repeat(500)) },
  { name: 'app/start.sh', data: Buffer.from('#!/bin/sh\necho oi\n'), mode: 0o755 },
  { name: 'app/vazio.txt', data: Buffer.alloc(0) },
  { name: 'app/bin.dat', data: Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 31) & 0xff)) },
];

test('crc32 bate com o valor conhecido de "123456789"', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('ZIP: o que se grava é o que se lê de volta, inclusive vazio e binário', () => {
  const zip = createZip(files);
  for (const f of files) assert.deepEqual(readZipEntry(zip, f.name), f.data);
  assert.equal(readZipEntry(zip, 'app/nao-existe'), null);
});

test('ZIP: guarda o modo de execução e marca o arquivo como criado em Unix', () => {
  const zip = createZip(files);
  // diretório central: procura a entrada de start.sh e lê os atributos externos
  let pos = zip.readUInt32LE(zip.length - 22 + 16);
  const modes = {};
  for (let i = 0; i < files.length; i++) {
    const nameLength = zip.readUInt16LE(pos + 28);
    const name = zip.toString('utf8', pos + 46, pos + 46 + nameLength);
    modes[name] = (zip.readUInt32LE(pos + 38) >>> 16) & 0o7777;
    pos += 46 + nameLength + zip.readUInt16LE(pos + 30) + zip.readUInt16LE(pos + 32);
  }
  assert.equal(modes['app/start.sh'], 0o755);
  assert.equal(modes['app/a.txt'], 0o644);
});

test('TAR.GZ: round-trip e modo de execução preservado no cabeçalho', () => {
  const tgz = createTarGz(files, 1_700_000_000);
  for (const f of files) assert.deepEqual(readTarGzEntry(tgz, f.name), f.data);
  assert.equal(readTarGzEntry(tgz, 'app/nao-existe'), null);

  const tar = gunzipSync(tgz);
  // o cabeçalho da 2ª entrada fica depois do 1º cabeçalho + dados do 1º arquivo (alinhados a 512)
  const second = 512 + Math.ceil(files[0].data.length / 512) * 512;
  assert.equal(tar.toString('utf8', second, second + 12).replace(/\0.*$/, ''), 'app/start.sh');
  assert.equal(tar.toString('ascii', second + 100, second + 107), '0000755');
});

test('TAR: rejeita caminhos longos demais em vez de gerar arquivo corrompido', () => {
  assert.throws(() => createTarGz([{ name: 'x'.repeat(101), data: Buffer.alloc(1) }]), /longo/);
});
