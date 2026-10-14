#!/usr/bin/env sh
# Painel de câmeras. Sem argumentos roda neste terminal (Ctrl+C para parar).
# Comandos: start (segundo plano), stop, status, open, autostart on/off, menu. Veja: ./start.sh help
# Usa o Node embutido em runtime/node (pacote de release) ou o Node instalado no PATH.
# Para o modo tempo real, coloque o ffmpeg em runtime/ (ou defina FFMPEG_PATH).
cd "$(dirname "$0")" || exit 1

if [ -f runtime/node ]; then
  chmod +x runtime/node 2>/dev/null
  NODE=./runtime/node
elif command -v node >/dev/null 2>&1; then
  NODE=node
else
  echo "Node.js não encontrado. Instale o Node 20.3 ou superior: https://nodejs.org" >&2
  echo "(ou use o pacote de release, que já vem com o Node embutido)" >&2
  exit 1
fi

# `exec` é seguro aqui: a CLI cria o processo em segundo plano por conta própria.
exec "$NODE" src/cli.js "$@"
