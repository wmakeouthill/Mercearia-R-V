const fs = require('fs');
const path = require('path');

function copyDir(src, dest, opts = {}) {
  const exclude = new Set(opts.exclude || []);
  const allowInside = Boolean(opts.allowInside);
  if (!fs.existsSync(src)) return false;
  const resolvedSrc = path.resolve(src);
  const resolvedDest = path.resolve(dest);
  // If dest is inside src and not explicitly allowed, abort to avoid recursion
  if (resolvedDest.startsWith(resolvedSrc) && !allowInside) {
    throw new Error(`Destination ${resolvedDest} is inside source ${resolvedSrc} — aborting to avoid recursion`);
  }

  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (exclude.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, opts);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  return true;
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const outDir = path.join(repoRoot, 'deploy', 'package');
  console.log('Creating deploy package at', outDir);
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  // Copy frontend build
  const frontendDist = path.join(repoRoot, 'frontend', 'dist', 'sistema-estoque', 'browser');
  if (!copyDir(frontendDist, path.join(outDir, 'frontend'))) {
    console.warn('Warning: frontend build not found at', frontendDist);
  } else {
    console.log('Copied frontend build');
  }

  // Copy backend jar
  const backendJar = path.join(repoRoot, 'backend-spring', 'target', 'backend-spring-0.0.1-SNAPSHOT.jar');
  if (fs.existsSync(backendJar)) {
    fs.copyFileSync(backendJar, path.join(outDir, 'backend-spring-0.0.1-SNAPSHOT.jar'));
    console.log('Copied backend jar');
  } else {
    console.warn('Warning: backend jar not found at', backendJar);
  }

  // Copy deploy scripts and configs
  const deployDir = path.join(repoRoot, 'deploy');
  if (fs.existsSync(deployDir)) {
    // exclude the generated package directory to avoid recursion; allow copying into outDir which is inside deploy
    copyDir(deployDir, path.join(outDir, 'deploy'), { exclude: ['package'], allowInside: true });
    console.log('Copied deploy scripts');
  }

  // Copy raw embedded Postgres data directory (if present) so deploy package
  // contains a pre-populated cluster. This replaces the previous behavior
  // which copied a SQL dump directory.
  const dataDir = path.join(repoRoot, 'backend-spring', 'data');
  if (fs.existsSync(dataDir)) {
    copyDir(dataDir, path.join(outDir, 'backend-spring', 'data'));
    console.log('Copied backend raw data directory');
  } else {
    console.log('No backend raw data directory found; skipping data copy');
  }

  // Copiar secrets (se existir) para o pacote de deploy
  const secretsDir = path.join(repoRoot, 'backend-spring', 'secrets');
  if (fs.existsSync(secretsDir)) {
    copyDir(secretsDir, path.join(outDir, 'secrets'));
    console.log('Copied backend secrets into deploy package');
  } else {
    console.log('No backend secrets directory found for deploy package');
  }

  console.log('Deploy package ready. You can SCP the folder deploy/package to your server.');
}

if (require.main === module) main();


