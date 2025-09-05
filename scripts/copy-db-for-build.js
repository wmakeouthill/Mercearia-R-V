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
    
    // Pular arquivos com nomes reservados do Windows que causam problemas
    const reservedNames = ['nul', 'con', 'prn', 'aux', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'];
    if (reservedNames.includes(entry.name.toLowerCase())) {
      console.log(`⚠️  Pulando arquivo com nome reservado do Windows: ${entry.name}`);
      continue;
    }
    
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else if (entry.isFile()) {
      try {
        // CÓPIA INTEGRAL - ignora apenas nomes reservados do Windows
        console.log(`📄 Copiando: ${srcPath} -> ${destPath}`);
        fs.copyFileSync(srcPath, destPath);
        
        // Preserve file attributes and timestamps for better fidelity
        const srcStats = fs.statSync(srcPath);
        fs.utimesSync(destPath, srcStats.atime, srcStats.mtime);
        
        // Verificar se a cópia foi bem-sucedida comparando tamanhos
        const destStats = fs.statSync(destPath);
        if (srcStats.size !== destStats.size) {
          throw new Error(`Copy verification failed: size mismatch (src: ${srcStats.size}, dest: ${destStats.size})`);
        }
      } catch (e) {
        console.error('⚠️  CRITICAL: Failed to copy file', srcPath, '->', destPath, ':', e.message || e);
        // Don't continue silently - this could cause database corruption
        throw e;
      }
    } else if (entry.isSymbolicLink()) {
      try {
        const linkTarget = fs.readlinkSync(srcPath);
        fs.symlinkSync(linkTarget, destPath);
        console.log('📎 Copied symlink:', srcPath, '->', destPath);
      } catch (e) {
        console.warn('Failed to copy symlink', srcPath, ':', e.message || e);
        // Continue for symlinks as they're not critical
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

function countFiles(dir) {
  let count = 0;
  if (!fs.existsSync(dir)) return count;
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    // Pular arquivos com nomes reservados do Windows (mesmo filtro da cópia)
    const reservedNames = ['nul', 'con', 'prn', 'aux', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'];
    if (reservedNames.includes(entry.name.toLowerCase())) {
      continue; // Não contar arquivos que são pulados na cópia
    }
    
    if (entry.isDirectory()) {
      count += countFiles(fullPath);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      count++;
    }
  }
  return count;
}

function copySecretsOnly(repoRoot) {
  // Only copy secrets - no duplicate database copy
  const secretsSrc = path.join(repoRoot, 'backend-spring', 'secrets');
  const secretsDest = path.join(repoRoot, 'electron', 'resources', 'backend-spring', 'secrets');
  if (fs.existsSync(secretsSrc)) {
    try {
      copyDirSync(secretsSrc, secretsDest);
      console.log('✅ Copied backend secrets for build');
    } catch (e) {
      console.error('❌ Failed to copy secrets:', e.message || e);
      process.exit(2);
    }
  } else {
    console.log('⚠️  No backend secrets directory found; skipping');
  }
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  // Instead of packaging a SQL dump, include the raw embedded Postgres data
  // directory so the packaged app can start with a pre-populated cluster.
  const srcDataDir = path.join(repoRoot, 'backend-spring', 'data');
  const destDataDir = path.join(repoRoot, 'electron', 'resources', 'data');
  console.log('🗄️  Copying COMPLETE PostgreSQL database from', srcDataDir);
  console.log('📁 Destination:', destDataDir);
  
  if (fs.existsSync(srcDataDir)) {
    try {
      // Clear destination first to ensure clean copy
      if (fs.existsSync(destDataDir)) {
        fs.rmSync(destDataDir, { recursive: true, force: true });
      }
      
      copyDirSync(srcDataDir, destDataDir);
      
      // Validate copy by counting files
      const srcFileCount = countFiles(srcDataDir);
      const destFileCount = countFiles(destDataDir);
      
      if (srcFileCount === destFileCount) {
        console.log(`✅ Backend data directory copied successfully: ${srcFileCount} files preserved`);
      } else {
        console.error(`❌ COPY INCOMPLETE! Source: ${srcFileCount} files, Destination: ${destFileCount} files`);
        process.exit(2);
      }
    } catch (e) {
      console.error('Failed to copy backend data directory:', e.message || e);
      process.exit(2);
    }
  } else {
    console.log('No backend-spring/data directory found; skipping data packaging');
  }

  // Copy only secrets (no duplicate database copy)
  copySecretsOnly(repoRoot);
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


