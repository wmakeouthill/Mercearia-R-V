#!/usr/bin/env node
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Build Otimizado para Windows - Iniciando...\n');

// Função para executar comandos com logs em tempo real
function runCommand(command, description, options = {}) {
    console.log(`📋 ${description}...`);
    console.log(`💻 Executando: ${command}\n`);
    
    try {
        const startTime = Date.now();
        const result = execSync(command, { 
            stdio: 'inherit', 
            shell: true, 
            cwd: options.cwd || process.cwd(),
            ...options
        });
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ ${description} concluído em ${duration}s\n`);
        return result;
    } catch (error) {
        console.error(`❌ Erro em: ${description}`);
        console.error(`💥 Comando falhou: ${command}`);
        console.error(`📝 Erro: ${error.message}\n`);
        process.exit(1);
    }
}

// Função para executar comando de forma assíncrona com timeout
function runCommandAsync(command, description, timeoutMinutes = 15) {
    return new Promise((resolve, reject) => {
        console.log(`📋 ${description}...`);
        console.log(`💻 Executando: ${command}`);
        console.log(`⏱️ Timeout: ${timeoutMinutes} minutos\n`);
        
        const startTime = Date.now();
        const child = spawn(command, { 
            stdio: 'inherit', 
            shell: true,
            cwd: process.cwd()
        });

        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error(`Timeout de ${timeoutMinutes} minutos atingido para: ${description}`));
        }, timeoutMinutes * 60 * 1000);

        child.on('close', (code) => {
            clearTimeout(timeout);
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            
            if (code === 0) {
                console.log(`✅ ${description} concluído em ${duration}s\n`);
                resolve();
            } else {
                reject(new Error(`Comando falhou com código ${code}: ${description}`));
            }
        });

        child.on('error', (error) => {
            clearTimeout(timeout);
            reject(new Error(`Erro ao executar: ${description} - ${error.message}`));
        });
    });
}

async function main() {
    try {
        // 1. Preparar ambiente
        console.log('📁 Diretório de trabalho:', process.cwd());
        
        // Verificar se já estamos na pasta electron
        const currentDir = path.basename(process.cwd());
        if (currentDir !== 'electron') {
            console.log('📁 Mudando para pasta electron...\n');
            process.chdir('electron');
        } else {
            console.log('✅ Já estamos na pasta electron\n');
        }

        // 2. Criar deploy package (sem cópia de dados ainda)
        runCommand(
            'node ../scripts/create-deploy-package.js', 
            'Criando pacote de deploy'
        );

        // 3. Limpeza de builds anteriores
        runCommand(
            '(rmdir /S /Q dist-installer2\\win-unpacked 2>nul || echo "Pasta limpa")',
            'Limpando builds anteriores'
        );

        // 4. Build do frontend
        runCommand(
            'npm run build:frontend',
            'Compilando frontend Angular'
        );

        // 5. Build do backend
        runCommand(
            'npm run build:backend', 
            'Compilando backend Spring Boot'
        );

        // 6. Build do Electron (TypeScript)
        runCommand(
            'npm run build',
            'Compilando Electron TypeScript'
        );

        // 7. AGORA copiar pasta data (por último antes do empacotamento)
        console.log('📊 Copiando base de dados (operação pesada)...');
        runCommand(
            'node ../scripts/copy-db-for-build.js',
            'Copiando base de dados para produção'
        );

        // 8. Configurar variáveis de ambiente para otimizar build
        process.env.ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES = 'true';
        process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL = '1'; // Compressão mais rápida
        process.env.DEBUG = ''; // Desabilitar debug verbose

        // 9. Electron-builder com timeout generoso e monitoramento
        console.log('📦 Iniciando empacotamento do executável...');
        console.log('⚠️  Esta etapa pode demorar 15-25 minutos devido ao tamanho dos arquivos');
        console.log('💡 O NSIS precisa comprimir ~1GB de dados, seja paciente...');
        console.log('🔍 Para monitorar progresso em outra janela: node ../scripts/build-monitor.js\n');
        
        // Iniciar monitoramento em background
        const { spawn: spawnAsync } = require('child_process');
        const monitor = spawnAsync('node', ['../scripts/build-monitor.js'], { 
            detached: true, 
            stdio: 'ignore'
        });
        monitor.unref();
        
        await runCommandAsync(
            'electron-builder --win --config.compression=store --config.nsis.warningsAsErrors=false', 
            'Criando instalador Windows (NSIS)',
            25 // 25 minutos de timeout
        );

        // 10. Deploy automático (se configurado)
        runCommand(
            'node ../scripts/maybe_auto_deploy.js',
            'Verificando auto-deploy'
        );

        // 11. Sucesso!
        console.log('🎉 BUILD CONCLUÍDO COM SUCESSO!');
        console.log('📦 Instalador gerado em: dist-installer2/');
        console.log('✨ Pronto para distribuição!\n');

    } catch (error) {
        console.error('\n❌ BUILD FALHOU!');
        console.error('💥 Erro:', error.message);
        console.error('\n🔧 Dicas para resolver:');
        console.error('   • Verifique se há espaço em disco suficiente (>5GB)');
        console.error('   • Feche outros programas para liberar memória');
        console.error('   • Execute como administrador se necessário');
        console.error('   • Verifique se o backend-spring/target/backend-spring-*.jar existe');
        process.exit(1);
    }
}

main();
