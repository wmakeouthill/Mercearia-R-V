const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Testando executável Electron...');

// Caminho para o executável
const exePath = path.join(__dirname, 'electron/dist-installer/win-unpacked/Sistema de Gestão de Estoque.exe');

console.log('Executável:', exePath);

// Executar o aplicativo
const electronProcess = spawn(exePath, [], {
    stdio: 'inherit',
    detached: false
});

electronProcess.on('error', (error) => {
    console.error('❌ Erro ao executar:', error);
});

electronProcess.on('close', (code) => {
    console.log(`✅ Processo finalizado com código: ${code}`);
});

// Aguardar 10 segundos e depois fechar
setTimeout(() => {
    console.log('⏰ Fechando aplicativo após 10 segundos...');
    electronProcess.kill();
}, 10000); 