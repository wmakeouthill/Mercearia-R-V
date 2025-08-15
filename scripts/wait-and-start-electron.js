const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { showNetworkInfo } = require('./show-network-info');

console.log('⏳ Aguardando serviços ficarem prontos...');

// Função para testar se um serviço está disponível
function testService(host, port, name, pathUrl = '/', protocol = 'http') {
    return new Promise((resolve) => {
    const client = protocol === 'https' ? https : http;
        const options = protocol === 'https'
            ? { hostname: host, port, path: pathUrl, rejectUnauthorized: false }
            : { hostname: host, port, path: pathUrl };
        const req = client.get(options, (res) => {
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

async function isFrontendReady() {
    // Testar localhost e 127 primeiro
    const hostsPrimary = ['localhost', '127.0.0.1'];
    const hostsLan = ['merceariarv.lan', 'merceariarv.app'];
    const protocols = ['http', 'https'];

    for (const proto of protocols) {
        for (const h of hostsPrimary) {
            if (await testService(h, 4200, 'Frontend Angular', '/', proto)) return true;
        }
        for (const h of hostsLan) {
            if (await testService(h, 4200, 'Frontend Angular', '/', proto)) return true;
        }
    }
    return false;
}

// Função para aguardar até todos os serviços estarem prontos
async function waitForServices() {
    let attempts = 0;
    // Tornar a espera mais resiliente: alguns ambientes demoram mais para o backend subir
    const maxAttempts = 120; // 120 tentativas = 120 segundos

    while (attempts < maxAttempts) {
        attempts++;
        console.log(`🔍 Verificação ${attempts}/${maxAttempts}...`);

    const backendReady = await testService('127.0.0.1', 3000, 'Backend', '/health');
    const frontendReady = await isFrontendReady();

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

    console.log('⚠️ Timeout atingido. Backend ou Frontend não ficaram prontos a tempo. Abortando start automático do Electron.');
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