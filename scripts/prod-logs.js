// Consulta logs de Cloud Run (producción) vía API REST.
// Uso: node scripts/prod-logs.js "<texto a buscar>" [dias]
const { execSync } = require('child_process');
const PROJECT = 'studio-5015730771-8ece8';
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const terms = (process.argv[2] || 'Server agent').split('|');
const days = Number(process.argv[3] || 30);
const since = new Date(Date.now() - days * 86400000).toISOString();
const filter = `resource.type="cloud_run_revision" AND resource.labels.service_name="studio" AND timestamp>="${since}" AND (${terms.map(t => `textPayload:"${t}"`).join(' OR ')})`;

(async () => {
  const r = await fetch('https://logging.googleapis.com/v2/entries:list', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceNames: [`projects/${PROJECT}`], filter, orderBy: 'timestamp desc', pageSize: 15 }),
  });
  const j = await r.json();
  if (j.error) return console.error(j.error.message);
  if (!j.entries?.length) return console.log('(sin resultados)');
  for (const e of j.entries) console.log(e.timestamp, '|', (e.textPayload || '').slice(0, 160).replace(/\s+/g, ' '));
})();
