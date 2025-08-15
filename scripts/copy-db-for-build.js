const fs = require('fs');
const path = require('path');

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error('Source directory does not exist: ' + src);
  }
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else if (entry.isFile()) {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (e) {
        console.warn('Failed to copy file', srcPath, e.message || e);
      }
    }
  }
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const src = path.join(repoRoot, 'backend-spring', 'data', 'pg');
  const dest = path.join(repoRoot, 'electron', 'resources', 'backend-spring', 'data', 'pg');

  console.log('Copying embedded Postgres data from', src, 'to', dest);
  if (!fs.existsSync(src)) {
    console.error('Source DB directory not found:', src);
    process.exit(1);
  }

  try {
    copyDirSync(src, dest);
    console.log('Copy completed successfully');
  } catch (e) {
    console.error('Copy failed:', e.message || e);
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}


