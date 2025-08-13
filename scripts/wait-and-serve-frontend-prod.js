const http = require('http');
const { spawn } = require('child_process');

console.log('⏳ Aguardando backend (http://127.0.0.1:3000/health) antes de servir o Frontend (produção)...');

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
      console.log('✅ Backend pronto! Servindo Frontend produção...');
      return true;
    }
    console.log(`🔍 Backend ainda iniciando... tentativa ${i}/${maxAttempts}`);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('⚠️ Timeout aguardando backend. Frontend (prod) não será iniciado automaticamente.');
  return false;
}

async function serveFrontend() {
  const ok = await waitForBackend();
  if (!ok) return;
  const proc = spawn('node', ['scripts/serve-frontend-prod.js'], { stdio: 'inherit', shell: true });
  proc.on('error', (err) => console.error('❌ Erro ao servir Frontend (prod):', err));
  proc.on('close', (code) => console.log(`🔚 Frontend (prod) finalizado com código ${code}`));
}

serveFrontend().catch(console.error);


