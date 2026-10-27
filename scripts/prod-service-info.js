// Muestra nombres (no valores) de variables de entorno y origen de despliegue del servicio Cloud Run de producción.
const { execSync } = require('child_process');
const out = execSync('gcloud run services describe studio --region us-central1 --project studio-5015730771-8ece8 --format=json', { encoding: 'utf8' });
const j = JSON.parse(out);
const c = j.spec.template.spec.containers[0];
console.log('ENV VARS:', (c.env || []).map(e => e.name + (e.valueFrom ? '(secret)' : '')).join(', '));
console.log('LABELS:', JSON.stringify(j.metadata.labels));
const a = { ...(j.metadata.annotations || {}), ...(j.spec.template.metadata.annotations || {}) };
for (const k of Object.keys(a)) if (/apphosting|firebase|build|source|commit/i.test(k)) console.log('ANNOT', k, '=', String(a[k]).slice(0, 100));
console.log('IMAGE:', c.image);
console.log('LAST UPDATE:', j.status?.conditions?.[0]?.lastTransitionTime);
