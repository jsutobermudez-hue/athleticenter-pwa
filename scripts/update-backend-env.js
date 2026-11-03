const { execSync } = require('child_process');
const fs = require('fs');

const PROJECT = 'studio-5015730771-8ece8';
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const H = { Authorization: 'Bearer ' + token, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' };
const base = `https://firebaseapphosting.googleapis.com/v1beta/projects/${PROJECT}/locations/us-central1/backends/studio`;

(async () => {
  const getRes = await fetch(base, { headers: H });
  const backend = await getRes.json();
  const currentEnv = backend.overrideEnv || [];

  // Parsear .env.local
  const envContent = fs.readFileSync('.env.local', 'utf8');
  const getVal = (key) => {
    const m = envContent.match(new RegExp(`^${key}="?([^"\\r\\n]+)"?`, 'm'));
    return m ? m[1] : null;
  };

  const newVars = [
    { variable: 'CRON_SECRET', value: getVal('CRON_SECRET') },
    { variable: 'WHATSAPP_GATEWAY_KEY', value: getVal('WHATSAPP_GATEWAY_KEY') },
    { variable: 'WHATSAPP_WEBHOOK_SECRET', value: getVal('WHATSAPP_WEBHOOK_SECRET') },
    { variable: 'WHATSAPP_GATEWAY_SP_URL', value: getVal('WHATSAPP_GATEWAY_SP_URL') || 'http://35.199.85.127:3001' }
  ];

  const map = new Map();
  for (const item of currentEnv) {
    map.set(item.variable, item.value);
  }
  for (const item of newVars) {
    if (item.value) map.set(item.variable, item.value);
  }

  const updatedOverrideEnv = Array.from(map.entries()).map(([variable, value]) => ({ variable, value }));

  console.log('Actualizando overrideEnv con', updatedOverrideEnv.length, 'variables...');
  const patchRes = await fetch(`${base}?updateMask=overrideEnv`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({
      overrideEnv: updatedOverrideEnv
    })
  });

  const patchData = await patchRes.json();
  if (patchRes.ok) {
    console.log('✅ Backend overrideEnv actualizado exitosamente.');
  } else {
    console.error('❌ Error al actualizar backend:', JSON.stringify(patchData, null, 2));
  }
})();
