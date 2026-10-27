// Genera el .env del gateway de São Paulo a partir de .env.local (sin imprimir valores), lo sube por SCP y lo borra localmente.
// Uso: node scripts/push-sp-env.js [--no-legacy]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; })
);
for (const k of ['WHATSAPP_GATEWAY_KEY', 'WHATSAPP_WEBHOOK_SECRET', 'CRON_SECRET']) {
  if (!env[k] || env[k].length < 24) { console.error(`Falta ${k} en .env.local`); process.exit(1); }
}
const lines = [
  `WHATSAPP_GATEWAY_KEY=${env.WHATSAPP_GATEWAY_KEY}`,
  `WHATSAPP_WEBHOOK_SECRET=${env.WHATSAPP_WEBHOOK_SECRET}`,
  `CRON_SECRET=${env.CRON_SECRET}`,
  `APP_URL=https://studio--studio-5015730771-8ece8.us-central1.hosted.app`,
  `PHONE_NUMBER=584146719204`,
];
if (!process.argv.includes('--no-legacy')) lines.push('LEGACY_GATEWAY_KEY=local-dev-key');

const tmp = path.join(os.tmpdir(), `sp_env_${Date.now()}`);
fs.writeFileSync(tmp, lines.join('\n') + '\n', { mode: 0o600 });
try {
  execSync(`gcloud compute scp "${tmp}" athleticenter-server:/home/jsutobermudez/app/whatsapp/.env --project athleticenter-app2 --zone southamerica-east1-c --quiet`, { stdio: 'ignore' });
  execSync(`gcloud compute ssh athleticenter-server --project athleticenter-app2 --zone southamerica-east1-c --quiet --command "chmod 600 /home/jsutobermudez/app/whatsapp/.env"`, { stdio: 'ignore' });
  console.log(`✅ .env subido a São Paulo (${lines.length} variables${process.argv.includes('--no-legacy') ? ', sin clave heredada' : ', con clave heredada temporal'})`);
} finally {
  fs.unlinkSync(tmp);
}
