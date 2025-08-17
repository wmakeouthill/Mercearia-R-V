const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

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

function getDbConfig() {
  const host = process.env.DEV_DB_HOST || process.env.DB_HOST || 'localhost';
  const port = process.env.DEV_DB_PORT || process.env.DB_PORT || '5432';
  const db = process.env.DEV_DB_NAME || process.env.DB_NAME || process.env.DB_DATABASE || 'postgres';
  const user = process.env.DEV_DB_USER || process.env.DB_USER || process.env.USER || process.env.USERNAME || 'postgres';
  const password = process.env.DEV_DB_PASSWORD || process.env.DB_PASSWORD || '';
  const dockerImage = process.env.PG_DOCKER_IMAGE || 'postgres:16';
  return { host, port, db, user, password, dockerImage };
}

function ensureDockerAvailable() {
  const res = childProcess.spawnSync('docker', ['--version'], { stdio: 'ignore' });
  if (res.error || res.status !== 0) {
    console.error('Docker não disponível. Instale Docker Desktop ou forneça um pg_dump funcional no PATH.');
    process.exit(1);
  }
}

function runPgDumpWithDocker({ host, port, db, user, password, dockerImage }, srcDump) {
  const outDir = path.resolve(path.dirname(srcDump));
  fs.mkdirSync(outDir, { recursive: true });
  const hostForDocker = (host === 'localhost' || host === '127.0.0.1') ? 'host.docker.internal' : host;
  const dockerArgs = [
    'run', '--rm',
    '-e', `PGPASSWORD=${password}`,
    '-v', `${outDir}:/out`,
    dockerImage,
    'pg_dump', '-h', hostForDocker, '-p', port, '-U', user, '-f', `/out/${path.basename(srcDump)}`, db
  ];
  console.log('Executando Docker:', 'docker', dockerArgs.join(' '));
  const dres = childProcess.spawnSync('docker', dockerArgs, { stdio: 'inherit' });
  if (dres.error || dres.status !== 0) {
    console.error('pg_dump via Docker falhou:', dres && dres.error ? dres.error.message || dres.error : dres.status);
    process.exit(1);
  }
  console.log('pg_dump via Docker executado com sucesso, arquivo gerado em', srcDump);
}

function copyDumpAndSecrets(repoRoot, srcDump) {
  const destDir = path.join(repoRoot, 'electron', 'resources', 'backend-spring', 'db');
  const destDump = path.join(destDir, 'dump_data.sql');
  try {
    fs.mkdirSync(destDir, { recursive: true });
    if (srcDump && fs.existsSync(srcDump)) {
      fs.copyFileSync(srcDump, destDump);
      console.log('DB dump copy completed successfully');
    } else {
      console.log('No SQL dump provided or not found; skipping dump copy');
    }
  } catch (e) {
    console.error('DB dump copy failed:', e.message || e);
    process.exit(2);
  }

  const secretsSrc = path.join(repoRoot, 'backend-spring', 'secrets');
  const secretsDest = path.join(repoRoot, 'electron', 'resources', 'backend-spring', 'secrets');
  if (fs.existsSync(secretsSrc)) {
    try {
      copyDirSync(secretsSrc, secretsDest);
      console.log('Copied backend secrets for build');
    } catch (e) {
      console.warn('Failed to copy secrets:', e.message || e);
    }
  } else {
    console.log('No backend secrets directory found; skipping');
  }
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  // Instead of packaging a SQL dump, include the raw embedded Postgres data
  // directory so the packaged app can start with a pre-populated cluster.
  const srcDataDir = path.join(repoRoot, 'backend-spring', 'data');
  const destDataDir = path.join(repoRoot, 'electron', 'resources', 'backend-spring', 'data');
  console.log('Copying backend-spring/data from', srcDataDir, 'to electron resources', destDataDir);
  if (fs.existsSync(srcDataDir)) {
    try {
      copyDirSync(srcDataDir, destDataDir);
      console.log('Backend data directory copied successfully');
    } catch (e) {
      console.error('Failed to copy backend data directory:', e.message || e);
      process.exit(2);
    }
  } else {
    console.log('No backend-spring/data directory found; skipping data packaging');
  }

  // Still copy secrets if present
  copyDumpAndSecrets(repoRoot, null);
  // Também copiar imagem padrão do frontend para servir como logo do splash
  try {
    const frontendLogo = path.join(repoRoot, 'frontend', 'shared', 'padrao.png');
    const destResourcesAssetsDir = path.join(repoRoot, 'electron', 'resources', 'assets');
    const destAssetsDir = path.join(repoRoot, 'electron', 'assets');
    if (fs.existsSync(frontendLogo)) {
      // Copy into electron/resources/assets (used by extraResources or runtime access)
      fs.mkdirSync(destResourcesAssetsDir, { recursive: true });
      fs.copyFileSync(frontendLogo, path.join(destResourcesAssetsDir, 'logo.png'));
      // Also copy into electron/assets so it is included inside the asar at assets/logo.png
      fs.mkdirSync(destAssetsDir, { recursive: true });
      fs.copyFileSync(frontendLogo, path.join(destAssetsDir, 'logo.png'));
      console.log('Copied frontend logo to electron resources as assets/logo.png and to electron/assets/logo.png');
    } else {
      console.log('No frontend logo found at', frontendLogo);
    }
  } catch (e) {
    console.warn('Failed to copy frontend logo to electron resources/assets and electron/assets:', e.message || e);
  }
}

if (require.main === module) {
  main();
}


