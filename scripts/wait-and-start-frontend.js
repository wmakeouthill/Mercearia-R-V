const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FAST_MODE = process.env.FAST_FRONTEND_START === 'true';
if (FAST_MODE) {
  console.log('⚡ FAST_FRONTEND_START=true: Iniciaremos o frontend em paralelo (sem aguardar health completo).');
} else {
  console.log('⏳ Aguardando backend (http://127.0.0.1:3000/health) antes de iniciar o Frontend...');
}

function testBackend() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:3000/health', (res) => {
      const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 400;
      resolve(ok);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

async function waitForBackend(maxAttempts = 120) {
  if (FAST_MODE) {
    // Esperar somente alguns segundos para o backend abrir a porta (tomcat + embedded pg começa paralelamente)
    const warmupSeconds = Number(process.env.FAST_FRONTEND_DELAY || 3);
    console.log(`⏳ FAST: aguardando ${warmupSeconds}s antes de subir frontend...`);
    await new Promise(r => setTimeout(r, warmupSeconds * 1000));
    console.log('✅ Iniciando Frontend em modo FAST (backend continuará iniciando ao fundo)...');
    return true;
  }
  for (let i = 1; i <= maxAttempts; i++) {
    const ready = await testBackend();
    if (ready) {
      console.log('✅ Backend pronto! Iniciando Frontend (Angular)...');
      return true;
    }
    console.log(`🔍 Backend ainda iniciando... tentativa ${i}/${maxAttempts}`);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('⚠️ Timeout aguardando backend. Frontend não será iniciado automaticamente.');
  return false;
}

async function startFrontend() {
  const ok = await waitForBackend();
  if (!ok) return;
  const args = process.argv.slice(2);
  // Suportar modos especiais: network -> npm run start:network, ip -> npm run start:ip
  let script = 'start';

  // Autodetectar certificados para forçar https quando usar apenas `npm run dev`
  const certDir = path.join(process.cwd(), 'frontend', 'certs');
  const certFile = path.join(certDir, 'merceariarv.app.pem');
  const keyFile = path.join(certDir, 'merceariarv.app-key.pem');
  const autoHttpsEnabled = process.env.AUTO_DEV_HTTPS !== 'false';
  const hasCerts = fs.existsSync(certFile) && fs.existsSync(keyFile);

  if (!args.includes('https') && hasCerts && autoHttpsEnabled) {
    console.log('🔐 Certificados detectados. Ativando HTTPS automático (pode desativar com AUTO_DEV_HTTPS=false).');
    args.push('https');
  }

  if (args.includes('https')) {
    // se incluir também network/ip, usar variante https correspondente
    if (args.includes('lan') || args.includes('network')) {
      script = 'run start:https:lan';
    } else {
      script = 'run start:https';
    }
  } else {
    if (args.includes('network')) script = 'run start:network';
    if (args.includes('ip')) script = 'run start:ip';
  }
  const extraEnv = { ...process.env };
  // Permitir override de host usado em start:https (por exemplo para IP) sem editar scripts
  if (process.env.DEV_HTTPS_HOST) {
    extraEnv.DEV_HTTPS_HOST = process.env.DEV_HTTPS_HOST;
  }
  const proc = spawn('npm', script.split(' '), { cwd: 'frontend', stdio: 'inherit', shell: true, env: extraEnv });
  proc.on('error', (err) => console.error('❌ Erro ao iniciar Frontend:', err));
  proc.on('close', (code) => console.log(`🔚 Frontend finalizado com código ${code}`));
}

startFrontend().catch(console.error);


