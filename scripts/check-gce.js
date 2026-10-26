const { execSync } = require('child_process');
const projects = [
  'athleticenter-app2',
  'athleticenter-cc761',
  'athleticenter-inv',
  'athleticenter-pro-2',
  'crucial-continuity-hndpd',
  'planning-with-ai-d7291',
  'project-0da0b3ff-2ed8-430b-862',
  'zitro-641cf',
  'studio-5015730771-8ece8'
];
for (const p of projects) {
  try {
    const res = execSync(`gcloud compute instances list --project ${p} --format="csv(name,zone,status,EXTERNAL_IP)"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (res && res.split('\n').length > 1) {
      console.log('PROJECT:', p);
      console.log(res);
    }
  } catch(e) {}
}
