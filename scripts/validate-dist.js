const fs = require('fs');
const path = require('path');

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function main() {
  const root = process.cwd();
  const installerDir = path.join(root, 'electron', 'dist-installer2', 'win-unpacked');
  console.log('Validating distribution at', installerDir);

  const checks = [
    { p: path.join(installerDir, 'resources', 'backend-spring', 'data', 'pg', 'PG_VERSION'), msg: 'PG_VERSION exists' },
    { p: path.join(installerDir, 'resources', 'backend-spring', 'backend-spring-0.0.1-SNAPSHOT.jar'), msg: 'backend jar present' },
    { p: path.join(installerDir, 'resources', 'frontend', 'index.html'), msg: 'frontend index present' }
  ];

  let ok = true;
  for (const c of checks) {
    if (!exists(c.p)) {
      console.error('MISSING:', c.msg, '->', c.p);
      ok = false;
    } else {
      console.log('OK:', c.msg);
    }
  }

  process.exit(ok ? 0 : 2);
}

if (require.main === module) main();


