const { spawn } = require('child_process');
const path = require('path');

function runAutoDeploy() {
  const user = process.env.SSH_USER;
  const host = process.env.SSH_HOST;
  if (!user || !host) {
    console.log('SSH_USER or SSH_HOST not set — skipping auto-deploy.');
    return Promise.resolve();
  }

  const scriptPath = path.join(__dirname, '..', 'deploy', 'scripts', 'auto_deploy_to_server.sh');
  console.log(`Auto-deploy: SSH_USER=${user} SSH_HOST=${host} -> running ${scriptPath}`);

  return new Promise((resolve, reject) => {
    const child = spawn('bash', [scriptPath], { stdio: 'inherit', env: process.env });
    child.on('exit', (code) => {
      if (code === 0) resolve(); else reject(new Error('auto-deploy failed with code ' + code));
    });
    child.on('error', (err) => reject(err));
  });
}

if (require.main === module) {
  runAutoDeploy().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}


