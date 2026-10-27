// Muestra los últimos builds/rollouts de App Hosting y su estado.
const { execSync } = require('child_process');
const PROJECT = 'studio-5015730771-8ece8';
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const H = { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT };
const base = `https://firebaseapphosting.googleapis.com/v1beta/projects/${PROJECT}/locations/us-central1/backends/studio`;
(async () => {
  const b = await (await fetch(`${base}/builds?pageSize=50`, { headers: H })).json();
  const builds = (b.builds || []).sort((x, y) => (y.createTime || '').localeCompare(x.createTime || '')).slice(0, 3);
  for (const bd of builds) {
    console.log('BUILD', bd.name.split('/').pop(), '|', bd.state, '|', bd.createTime, '| commit', (bd.source?.codebase?.hash || '').slice(0, 7), bd.error ? '| ERROR: ' + JSON.stringify(bd.error).slice(0, 300) : '');
    if (bd.buildLogsUri) console.log('   logs:', bd.buildLogsUri);
  }
  const r = await (await fetch(`${base}/rollouts?pageSize=50`, { headers: H })).json();
  const rolls = (r.rollouts || []).sort((x, y) => (y.createTime || '').localeCompare(x.createTime || '')).slice(0, 2);
  for (const ro of rolls) console.log('ROLLOUT', ro.name.split('/').pop(), '|', ro.state, '|', ro.createTime, ro.error ? '| ERROR: ' + JSON.stringify(ro.error).slice(0, 300) : '');
})();
