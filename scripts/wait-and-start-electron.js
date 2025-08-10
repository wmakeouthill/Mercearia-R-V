const http = require('http');
const { spawn } = require('child_process');
const { showNetworkInfo } = require('./show-network-info');

console.log('⏳ Aguardando serviços ficarem prontos...');

// Função para testar se um serviço está disponível
function testService(host, port, name) {
    return new Promise((resolve) => {
        const req = http.get(`http://${host}:${port}`, (res) => {
            console.log(`✅ ${name} está pronto!`);
            resolve(true);
        });

        req.on('error', () => {
            resolve(false);
        });

        req.setTimeout(2000, () => {
            req.destroy();
            resolve(false);
        });
    });
}

// Função para aguardar até todos os serviços estarem prontos
async function waitForServices() {
    let attempts = 0;
    const maxAttempts = 30; // 30 tentativas = 30 segundos

    while (attempts < maxAttempts) {
        attempts++;
        console.log(`🔍 Verificação ${attempts}/${maxAttempts}...`);

        const backendReady = await testService('localhost', 3000, 'Backend');
        const frontendReady = await testService('localhost', 4200, 'Frontend Angular');

        if (backendReady && frontendReady) {
            console.log('🎉 Todos os serviços prontos! Iniciando Electron...');

            // Mostrar informações de rede se estiver rodando no modo network
            if (process.argv.includes('network') || process.env.npm_lifecycle_event === 'dev:network' || process.env.npm_lifecycle_event === 'dev:ip') {
                showNetworkInfo();
            }

            return true;
        }

        if (attempts < maxAttempts) {
            console.log('⏳ Aguardando 1 segundo antes da próxima verificação...');
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    console.log('⚠️ Timeout atingido. Iniciando Electron mesmo assim...');
    return false;
}

// Iniciar Electron após aguardar serviços
async function startElectron() {
    await waitForServices();

    console.log('🚀 Iniciando Electron...');
    const electronProcess = spawn('npm', ['run', 'dev'], {
        cwd: 'electron',
        stdio: 'inherit',
        shell: true
    });

    electronProcess.on('error', (error) => {
        console.error('❌ Erro ao iniciar Electron:', error);
    });

    electronProcess.on('close', (code) => {
        console.log(`🔚 Electron finalizado com código ${code}`);
    });
}

// Executar
startElectron().catch(console.error);