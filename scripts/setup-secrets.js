// Crea (o rota) secretos en Secret Manager y da acceso a App Hosting. Nunca imprime los valores.
// Uso: node scripts/setup-secrets.js
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT = 'studio-5015730771-8ece8';
const SA = `firebase-app-hosting-compute@${PROJECT}.iam.gserviceaccount.com`;
const SECRETS = ['cron-secret', 'whatsapp-gateway-key', 'whatsapp-webhook-secret'];
const run = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

const generated = {};
for (const name of SECRETS) {
  const value = crypto.randomBytes(36).toString('base64url');
  generated[name] = value;
  const tmp = path.join(os.tmpdir(), `sec_${name}_${Date.now()}`);
  fs.writeFileSync(tmp, value, { mode: 0o600 });
  try {
    try { run(`gcloud secrets describe ${name} --project ${PROJECT}`); }
    catch { run(`gcloud secrets create ${name} --project ${PROJECT} --replication-policy=automatic`); }
    run(`gcloud secrets versions add ${name} --project ${PROJECT} --data-file="${tmp}"`);
    run(`gcloud secrets add-iam-policy-binding ${name} --project ${PROJECT} --member=serviceAccount:${SA} --role=roles/secretmanager.secretAccessor`);
    console.log(`✅ ${name}: versión nueva creada y acceso concedido a App Hosting`);
  } finally {
    fs.unlinkSync(tmp);
  }
}

// Guardar también en .env.local (desarrollo local) sin mostrarlos.
const envPath = path.join(__dirname, '..', '.env.local');
let env = fs.readFileSync(envPath, 'utf8');
const map = { CRON_SECRET: 'cron-secret', WHATSAPP_GATEWAY_KEY: 'whatsapp-gateway-key', WHATSAPP_WEBHOOK_SECRET: 'whatsapp-webhook-secret' };
for (const [k, s] of Object.entries(map)) {
  const line = `${k}="${generated[s]}"`;
  env = new RegExp(`^${k}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), line) : env.trimEnd() + `\n${line}\n`;
}
if (!/^WHATSAPP_GATEWAY_SP_URL=/m.test(env)) env = env.trimEnd() + `\nWHATSAPP_GATEWAY_SP_URL="http://35.199.85.127:3001"\n`;
fs.writeFileSync(envPath, env);
console.log('✅ .env.local actualizado (CRON_SECRET, WHATSAPP_GATEWAY_KEY, WHATSAPP_WEBHOOK_SECRET, WHATSAPP_GATEWAY_SP_URL)');
