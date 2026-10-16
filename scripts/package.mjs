#!/usr/bin/env node
// Gera os pacotes de release em dist/. Só usa módulos nativos do Node.
//
//   node scripts/package.mjs                      pacote da plataforma atual (com Node embutido)
//   node scripts/package.mjs --target win-x64     um alvo específico (pode repetir)
//   node scripts/package.mjs --all                todos os alvos + o pacote "sem-node"
//   opções: --version 1.2.3   --node-version 24.21.0
//
// Alvos: win-x64 (.zip), linux-x64 e linux-arm64 (.tar.gz), sem-node (.zip, exige Node instalado).
// O Node embutido vem de nodejs.org e tem o SHA-256 conferido antes do uso.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createTarGz, createZip, readTarGzEntry, readZipEntry } from './archive.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const cache = join(dist, '.cache');
const APP = 'open-picture-painel-cam';

// O que vai no pacote (testes e dados locais ficam de fora).
const INCLUDE = ['src', 'public', 'package.json', 'config.example.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'start.bat', 'painel.bat', 'start.sh'];

const TARGETS = {
  'win-x64': { id: 'win-x64', ext: 'zip', nodeExt: 'zip', binary: 'node.exe', bundled: true },
  'linux-x64': { id: 'linux-x64', ext: 'tar.gz', nodeExt: 'tar.gz', binary: 'bin/node', bundled: true },
  'linux-arm64': { id: 'linux-arm64', ext: 'tar.gz', nodeExt: 'tar.gz', binary: 'bin/node', bundled: true },
  'sem-node': { id: 'sem-node', ext: 'zip', bundled: false },
};

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function hostTarget() {
  if (process.platform === 'win32' && process.arch === 'x64') return 'win-x64';
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64';
  return 'sem-node';
}

/** Scripts de início precisam do fim de linha certo, independentemente do checkout. */
function normalize(rel, data) {
  if (rel === 'start.sh') return Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'));
  if (rel === 'start.bat') return Buffer.from(data.toString('utf8').replace(/\r?\n/g, '\r\n'));
  return data;
}

function collect(rel = '') {
  const files = [];
  for (const item of rel ? [rel] : INCLUDE) {
    const full = join(root, item);
    if (readdirSafe(full)) {
      for (const child of readdirSafe(full).sort()) files.push(...collect(posix.join(item, child)));
    } else {
      files.push({ rel: item, data: normalize(item, readFileSync(full)), mode: item === 'start.sh' ? 0o755 : 0o644 });
    }
  }
  return files;
}

function readdirSafe(path) {
  try { return readdirSync(path); } catch { return null; } // arquivo comum: não é diretório
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Baixa (com cache), confere o SHA-256 e extrai só o executável do Node e a licença. */
async function nodeRuntime(spec, version) {
  const top = `node-v${version}-${spec.id}`;
  const file = `${top}.${spec.nodeExt}`;
  const base = `https://nodejs.org/dist/v${version}`;

  const sums = (await download(`${base}/SHASUMS256.txt`)).toString('utf8');
  const expected = sums.split('\n').map((l) => l.trim().split(/\s+/)).find(([, name]) => name === file)?.[0];
  if (!expected) throw new Error(`Node ${version} não publica ${file}`);

  mkdirSync(cache, { recursive: true });
  const cached = join(cache, file);
  let archive = existsSync(cached) ? readFileSync(cached) : null;
  if (!archive || sha256(archive) !== expected) {
    console.log(`  baixando ${file}…`);
    archive = await download(`${base}/${file}`);
    if (sha256(archive) !== expected) throw new Error(`SHA-256 de ${file} não confere: download corrompido ou adulterado`);
    writeFileSync(cached, archive);
  }

  const read = spec.nodeExt === 'zip' ? readZipEntry : readTarGzEntry;
  const binary = read(archive, `${top}/${spec.binary}`);
  const license = read(archive, `${top}/LICENSE`);
  if (!binary || !license) throw new Error(`Executável do Node não encontrado dentro de ${file}`);
  return { binary, license };
}

async function build(targetName, { version, nodeVersion }) {
  const spec = TARGETS[targetName];
  const name = `${APP}-v${version}-${spec.id}`;
  console.log(`\n${name}.${spec.ext}`);

  const entries = collect().map(({ rel, data, mode }) => ({ name: `${name}/${rel}`, data, mode }));

  if (spec.bundled) {
    const { binary, license } = await nodeRuntime(spec, nodeVersion);
    const exe = spec.binary.split('/').pop();
    entries.push(
      { name: `${name}/runtime/${exe}`, data: binary, mode: 0o755 },
      { name: `${name}/runtime/LICENSE-node.txt`, data: license }, // a licença do Node exige ser redistribuída junto
    );
    console.log(`  Node v${nodeVersion} embutido (${(binary.length / 1e6).toFixed(0)} MB)`);
  }

  const out = join(dist, `${name}.${spec.ext}`);
  const archive = spec.ext === 'zip' ? createZip(entries) : createTarGz(entries);
  writeFileSync(out, archive);
  console.log(`  ${(archive.length / 1e6).toFixed(1)} MB  ${entries.length} arquivos`);
  return { file: `${name}.${spec.ext}`, sha: sha256(archive) };
}

const { values } = parseArgs({
  options: {
    target: { type: 'string', multiple: true },
    all: { type: 'boolean' },
    version: { type: 'string' },
    'node-version': { type: 'string' },
  },
});

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const options = { version: values.version ?? pkg.version, nodeVersion: values['node-version'] ?? process.versions.node };
const targets = values.all ? Object.keys(TARGETS) : values.target ?? [hostTarget()];

for (const t of targets) {
  if (!TARGETS[t]) {
    console.error(`Alvo desconhecido: ${t}. Use: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }
}

mkdirSync(dist, { recursive: true });
const built = [];
for (const target of targets) built.push(await build(target, options));

writeFileSync(join(dist, 'SHA256SUMS.txt'), built.map(({ file, sha }) => `${sha}  ${file}`).join('\n') + '\n');
console.log(`\nPronto: ${dist}`);
