const { execSync } = require('child_process');

const PROJECT = 'studio-5015730771-8ece8';
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const H = { Authorization: 'Bearer ' + token, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' };
const base = `https://firebaseapphosting.googleapis.com/v1beta/projects/${PROJECT}/locations/us-central1/backends/studio`;

const now = new Date();
const dateStr = now.toISOString().split('T')[0];
const timeSuffix = String(now.getTime()).slice(-4);
const buildId = `build-${dateStr}-${timeSuffix}`;

async function trigger() {
  console.log(`Iniciando build en Firebase App Hosting: ${buildId}...`);

  const buildBody = {
    source: {
      codebase: {
        branch: 'main'
      }
    }
  };

  const createRes = await fetch(`${base}/builds?buildId=${buildId}`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify(buildBody)
  });

  const createData = await createRes.json();
  if (!createRes.ok) {
    console.error('Error al crear build:', JSON.stringify(createData, null, 2));
    process.exit(1);
  }

  console.log('Build creado exitosamente:', createData.name);
  console.log('Esperando compilación...');

  // Monitorear build
  let state = createData.state || 'BUILDING';
  while (state === 'BUILDING' || state === 'STATE_UNSPECIFIED') {
    await new Promise(r => setTimeout(r, 10000));
    const checkRes = await fetch(`${base}/builds/${buildId}`, { headers: H });
    const checkData = await checkRes.json();
    state = checkData.state;
    console.log(`[${new Date().toLocaleTimeString()}] Estado de build: ${state}`);
    if (state === 'READY') {
      console.log('¡Build READY! Procediendo a desplegar Rollout...');
      
      const rolloutId = `rollout-${dateStr}-${timeSuffix}`;
      const rolloutBody = {
        build: checkData.name
      };

      const rollRes = await fetch(`${base}/rollouts?rolloutId=${rolloutId}`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify(rolloutBody)
      });
      const rollData = await rollRes.json();
      console.log('Rollout creado:', rollData.name || rollData);
      return;
    } else if (state === 'FAILED') {
      console.error('Build falló:', JSON.stringify(checkData.error, null, 2));
      process.exit(1);
    }
  }
}

trigger().catch(console.error);
