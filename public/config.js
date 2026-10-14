const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const general = $('general');
const form = $('camera-form');
let config = null;
let editingId = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body && JSON.stringify(options.body),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function status(message, kind = 'ok') {
  const node = $('status');
  node.textContent = message;
  node.className = kind;
}

async function run(action, successMessage) {
  try {
    await action();
    if (successMessage) status(successMessage);
  } catch (err) {
    status(err.message, 'error');
  }
}

function credentialsLabel(cam) {
  if (cam.username) return `Própria (${cam.username})`;
  return config.auth.username ? 'Global' : 'Nenhuma';
}

function renderAll() {
  general.refreshDelayMs.value = config.refreshDelayMs;
  general.username.value = config.auth.username;
  general.password.value = '';
  general.password.placeholder = config.auth.hasPassword ? '•••••• (definida)' : '';

  const body = $('cameras');
  body.replaceChildren(...config.cameras.map((cam) => {
    const result = el('span', { className: 'result' });
    return el('tr', {},
      el('td', {}, cam.name),
      el('td', {}, cam.ip),
      el('td', {}, credentialsLabel(cam)),
      el('td', {}, cam.refreshDelayMs ? `${cam.refreshDelayMs} ms` : `Global (${config.refreshDelayMs} ms)`),
      el('td', { className: 'actions' },
        el('button', { className: 'btn', type: 'button', onclick: () => testCamera(cam, result) }, 'Testar'),
        ' ',
        el('button', { className: 'btn', type: 'button', onclick: () => startEdit(cam) }, 'Editar'),
        ' ',
        el('button', { className: 'btn danger', type: 'button', onclick: () => removeCamera(cam) }, 'Excluir'),
        result));
  }));
  $('no-cameras').hidden = config.cameras.length > 0;
}

async function testCamera(cam, result) {
  result.className = 'result';
  result.textContent = 'testando…';
  try {
    const res = await fetch(`/api/cameras/${cam.id}/snapshot?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const kb = ((await res.blob()).size / 1024).toFixed(0);
    result.className = 'result ok';
    result.textContent = `OK (${kb} KB)`;
  } catch (err) {
    result.className = 'result error';
    result.textContent = err.message;
  }
}

function startEdit(cam) {
  editingId = cam.id;
  form.name.value = cam.name;
  form.ip.value = cam.ip;
  form.username.value = cam.username;
  form.refreshDelayMs.value = cam.refreshDelayMs ?? '';
  form.password.value = '';
  form.password.placeholder = cam.hasPassword ? '•••••• (definida)' : '';
  $('camera-form-title').textContent = `Editando: ${cam.name}`;
  $('camera-submit').textContent = 'Salvar alterações';
  $('camera-cancel').hidden = false;
  form.scrollIntoView({ behavior: 'smooth' });
  form.name.focus();
}

function resetForm() {
  editingId = null;
  form.reset();
  form.password.placeholder = '';
  $('camera-form-title').textContent = 'Nova câmera';
  $('camera-submit').textContent = 'Cadastrar';
  $('camera-cancel').hidden = true;
}

function removeCamera(cam) {
  if (!confirm(`Excluir a câmera "${cam.name}"?`)) return;
  run(async () => {
    config = await api(`/api/cameras/${cam.id}`, { method: 'DELETE' });
    if (editingId === cam.id) resetForm();
    renderAll();
  }, 'Câmera excluída.');
}

general.addEventListener('submit', (e) => {
  e.preventDefault();
  run(async () => {
    config = await api('/api/settings', {
      method: 'PUT',
      body: {
        refreshDelayMs: Number(general.refreshDelayMs.value),
        auth: { username: general.username.value, password: general.password.value },
      },
    });
    renderAll();
  }, 'Configurações salvas.');
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  run(async () => {
    if (editingId) {
      config = await api(`/api/cameras/${editingId}`, { method: 'PUT', body });
    } else {
      await api('/api/cameras', { method: 'POST', body });
      config = await api('/api/config');
    }
    resetForm();
    renderAll();
  }, editingId ? 'Câmera atualizada.' : 'Câmera cadastrada.');
});

$('camera-cancel').addEventListener('click', resetForm);

run(async () => {
  config = await api('/api/config');
  renderAll();
});
