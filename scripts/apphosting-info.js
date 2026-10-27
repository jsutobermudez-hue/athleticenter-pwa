// Inspecciona la configuración del backend de App Hosting (nombres de variables, rama, último build). No muestra valores.
const { execSync } = require('child_process');
const PROJECT = 'studio-5015730771-8ece8';
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const H = { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT };
const base = `https://firebaseapphosting.googleapis.com/v1beta/projects/${PROJECT}/locations/us-central1`;

(async () => {
  const backends = await (await fetch(`${base}/backends`, { headers: H })).json();
  for (const b of backends.backends || []) {
    console.log('BACKEND:', b.name.split('/').pop(), '| repo:', b.codebase?.repository?.split('/').pop(), '| rootDir:', b.codebase?.rootDirectory || '/');
    const trig = await (await fetch(`${base}/backends/${b.name.split('/').pop()}/traffic`, { headers: H })).json();
    console.log('  rollout policy:', JSON.stringify(trig.rolloutPolicy || {}), '| target:', JSON.stringify(trig.target || trig.current || {}).slice(0, 200));
    const builds = await (await fetch(`${base}/backends/${b.name.split('/').pop()}/builds?pageSize=3`, { headers: H })).json();
    for (const bd of (builds.builds || []).slice(0, 3)) {
      const envNames = (bd.config?.env || []).map(e => e.variable + (e.secret ? '(secret)' : ''));
      console.log('  BUILD', bd.name.split('/').pop(), bd.state, bd.createTime, '| commit:', bd.source?.codebase?.hash?.slice(0, 7), '| branch:', bd.source?.codebase?.branch, '| env:', envNames.join(','));
    }
  }
})();
