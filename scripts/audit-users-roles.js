// Lee la colección users vía REST con el token de gcloud (admin, no pasa por reglas).
// Uso: node scripts/audit-users-roles.js
const { execSync } = require('child_process');
const PROJECT = 'studio-5015730771-8ece8';
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();

async function main() {
  let pageToken = '';
  const rows = [];
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT } });
    const data = await res.json();
    if (data.error) { console.error(data.error); return; }
    for (const d of data.documents || []) {
      const f = d.fields || {};
      const id = d.name.split('/').pop();
      rows.push({
        id,
        role: f.role?.stringValue ?? '(sin rol)',
        email: (f.email?.stringValue || '').replace(/(.{3}).*(@.*)/, '$1***$2'),
        customerId: f.customerId?.stringValue ? 'sí' : '',
      });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  const byRole = rows.reduce((a, r) => ((a[r.role] = (a[r.role] || 0) + 1), a), {});
  console.log('TOTAL USERS:', rows.length);
  console.log('POR ROL:', byRole);
  console.log('AGENTE SERVIDOR:', rows.filter(r => r.email.startsWith('ser')));
  console.log('ROLES NO ESTÁNDAR:', rows.filter(r => !['superadmin','gerencia','admin','ventas','deposito','cliente'].includes(r.role)));
}
main();
