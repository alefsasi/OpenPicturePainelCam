#!/usr/bin/env sh
# Inicia o painel de câmeras. Opcional: PORT=7391 HOST=0.0.0.0 ./start.sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js não encontrado. Instale o Node 20.3 ou superior: https://nodejs.org" >&2
  exit 1
fi

exec node src/index.js
