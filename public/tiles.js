// Atualização de uma câmera por snapshot (usada pela grid e pelas miniaturas do celular).

/**
 * Cada tile pede o próximo snapshot `delay` ms depois do início do anterior
 * (nunca sobrepõe pedidos: se a câmera demorar mais que o delay, espera ela).
 * Só existem tiles para as câmeras visíveis, então só elas são consultadas.
 */
export function startTile(tile, camera, delay) {
  const img = tile.querySelector('img');
  let timer = null;
  let aborter = null;
  let stopped = false;
  let lastUrl = null;

  async function tick() {
    const started = performance.now();
    aborter = new AbortController();
    try {
      const res = await fetch(`/api/cameras/${camera.id}/snapshot?t=${Date.now()}`, { cache: 'no-store', signal: aborter.signal });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      img.src = url;
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = url;
      tile.classList.remove('offline');
      tile.removeAttribute('title');
    } catch (err) {
      if (stopped) return;
      tile.classList.add('offline');
      tile.title = err.message;
      tile.querySelector('.msg').textContent = err.message;
    }
    if (!stopped) timer = setTimeout(tick, Math.max(0, delay - (performance.now() - started)));
  }

  tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    aborter?.abort();
    if (lastUrl) URL.revokeObjectURL(lastUrl);
  };
}
