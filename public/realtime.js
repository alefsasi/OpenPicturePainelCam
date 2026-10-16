// Player de vídeo em tempo real. Um único WebSocket leva todas as câmeras visíveis
// (evita o limite de ~6 conexões HTTP por origem, que estouraria numa grid 4x4).
//
// Servidor -> cliente: texto {"id","state":"live"|"error","message"}
//                      binário [1 byte: tamanho do id][id][JPEG]
// Cliente -> servidor: {"watch": ["id", ...]}

const MAX_RETRY_MS = 10_000;

/**
 * @param {Map<string, HTMLElement>} initialTiles  id da câmera -> elemento .tile (com <img> e .msg)
 * @returns {(() => void) & { setTiles(tiles: Map<string, HTMLElement>): void }}
 *   função que encerra o stream; `.setTiles` troca as câmeras assistidas sem reconectar
 *   (as que saem da tela deixam de ser pedidas ao servidor).
 */
export function startRealtime(initialTiles) {
  let tiles = new Map(initialTiles);
  const lastUrl = new Map(); // id -> object URL do último quadro (para liberar memória)
  const decoder = new TextDecoder();
  let ws = null;
  let timer = null;
  let stopped = false;
  let attempt = 0;

  const setOffline = (tile, message) => {
    tile.classList.add('offline');
    tile.title = message;
    tile.querySelector('.msg').textContent = message;
  };
  const setLive = (tile) => {
    if (!tile.classList.contains('offline')) return;
    tile.classList.remove('offline');
    tile.removeAttribute('title');
  };

  function onFrame(buffer) {
    const bytes = new Uint8Array(buffer);
    const idLength = bytes[0];
    const id = decoder.decode(bytes.subarray(1, 1 + idLength));
    const tile = tiles.get(id);
    if (!tile) return;

    const url = URL.createObjectURL(new Blob([bytes.subarray(1 + idLength)], { type: 'image/jpeg' }));
    tile.querySelector('img').src = url;
    URL.revokeObjectURL(lastUrl.get(id));
    lastUrl.set(id, url);
    setLive(tile);
  }

  function onStatus(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    const tile = tiles.get(msg.id);
    if (!tile) return;
    if (msg.state === 'live') setLive(tile);
    else if (msg.state === 'error') setOffline(tile, msg.message || 'Falha no stream');
  }

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}/api/stream`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      attempt = 0;
      ws.send(JSON.stringify({ watch: [...tiles.keys()] }));
    };
    ws.onmessage = (e) => (typeof e.data === 'string' ? onStatus(e.data) : onFrame(e.data));
    ws.onclose = () => {
      if (stopped) return;
      tiles.forEach((tile) => setOffline(tile, 'Reconectando…'));
      timer = setTimeout(connect, Math.min(MAX_RETRY_MS, 1000 * 2 ** attempt++));
    };
  }

  connect();

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
    lastUrl.forEach((url) => URL.revokeObjectURL(url));
  };
  stop.setTiles = (next) => {
    tiles = new Map(next);
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ watch: [...tiles.keys()] }));
  };
  return stop;
}
