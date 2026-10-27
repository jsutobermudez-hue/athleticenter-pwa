// Prueba de seguridad del gateway de São Paulo sin enviar mensajes reales (usa un número inválido).
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const URL_ = 'http://35.199.85.127:3001';
const body = JSON.stringify({ number: '58000', text: 'prueba' });
const call = async (label, key, expect) => {
  const r = await fetch(`${URL_}/api/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body });
  const j = await r.json().catch(() => ({}));
  const ok = expect(r.status);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} -> HTTP ${r.status} ${j.error || ''}`);
};
(async () => {
  const s = await (await fetch(`${URL_}/api/status`)).json();
  console.log('STATUS:', JSON.stringify(s));
  await call('Sin clave (debe rechazar)', null, st => st === 401);
  await call('Clave falsa (debe rechazar)', 'x'.repeat(48), st => st === 401);
  await call('Clave nueva (debe autorizar; número inválido)', env.WHATSAPP_GATEWAY_KEY, st => st !== 401);
  await call('Clave heredada temporal (autoriza en transición)', 'local-dev-key', st => st !== 401);
  const q = await fetch(`${URL_}/api/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [] }) });
  console.log(`${q.status === 401 ? 'OK  ' : 'FAIL'} Cola sin clave (debe rechazar) -> HTTP ${q.status}`);
})();
