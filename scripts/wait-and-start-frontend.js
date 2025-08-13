const http = require('http');
const { spawn } = require('child_process');

console.log('⏳ Aguardando backend (http://127.0.0.1:3000/health) antes de iniciar o Frontend...');

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
  if (args.includes('network')) script = 'run start:network';
  if (args.includes('ip')) script = 'run start:ip';
  const proc = spawn('npm', script.split(' '), { cwd: 'frontend', stdio: 'inherit', shell: true });
  proc.on('error', (err) => console.error('❌ Erro ao iniciar Frontend:', err));
  proc.on('close', (code) => console.log(`🔚 Frontend finalizado com código ${code}`));
}

startFrontend().catch(console.error);


