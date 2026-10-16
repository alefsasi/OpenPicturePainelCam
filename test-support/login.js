// Entra no painel de teste e devolve o cookie de sessão para as próximas chamadas.
export async function login(base, password = 'admin') {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(`login falhou: HTTP ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
}
