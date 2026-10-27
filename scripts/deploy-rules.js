// Despliega firestore.rules y storage.rules vía API de Firebase Rules, guardando el ruleset anterior para rollback.
// Uso:  node scripts/deploy-rules.js            (despliega ambos)
//       node scripts/deploy-rules.js rollback   (restaura el último respaldo)
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT = 'studio-5015730771-8ece8';
const BUCKET = 'studio-5015730771-8ece8.firebasestorage.app';
const BACKUP = path.join(__dirname, '..', '.rules-rollback.json');
const API = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}`;
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT };

const RELEASES = {
  firestore: { release: `projects/${PROJECT}/releases/cloud.firestore`, file: 'firestore.rules' },
  storage: { release: `projects/${PROJECT}/releases/firebase.storage/${BUCKET}`, file: 'storage.rules' },
};

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (j.error) throw new Error(`${method} ${url}: ${JSON.stringify(j.error)}`);
  return j;
}

async function getRelease(name) { return api('GET', `https://firebaserules.googleapis.com/v1/${name}`); }

async function setRelease(name, rulesetName) {
  return api('PATCH', `https://firebaserules.googleapis.com/v1/${name}`, { release: { name, rulesetName } });
}

async function deploy() {
  const backup = {};
  for (const [key, { release, file }] of Object.entries(RELEASES)) {
    const current = await getRelease(release);
    backup[key] = current.rulesetName;
    const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const rs = await api('POST', `${API}/rulesets`, { source: { files: [{ name: file, content }] } });
    await setRelease(release, rs.name);
    console.log(`✅ ${key}: ${current.rulesetName.split('/').pop()} -> ${rs.name.split('/').pop()}`);
  }
  fs.writeFileSync(BACKUP, JSON.stringify({ at: new Date().toISOString(), ...backup }, null, 2));
  console.log(`Respaldo para rollback guardado en ${BACKUP}`);
}

async function rollback() {
  const b = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  for (const [key, { release }] of Object.entries(RELEASES)) {
    if (b[key]) { await setRelease(release, b[key]); console.log(`↩️  ${key} restaurado a ${b[key].split('/').pop()}`); }
  }
}

(process.argv[2] === 'rollback' ? rollback() : deploy()).catch(e => { console.error('ERROR:', e.message); process.exit(1); });
