#!/usr/bin/env node
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Build Windows OTIMIZADO - Versão Corrigida...\n');

// Função para matar apenas processos específicos (não os do build atual)
function killHangingProcesses() {
    console.log('🔪 Eliminando processos travados...');
    try {
        // Matar apenas processos electron, não todos os node.js
        const commands = [
            'taskkill /F /IM electron.exe /T || echo "Nenhum electron encontrado"',
            'taskkill /F /IM "Sistema de Gestão de Estoque.exe" /T || echo "Nenhum app encontrado"'
        ];
        
        commands.forEach(cmd => {
            try {
                execSync(cmd, { stdio: 'pipe', timeout: 5000 });
            } catch (e) {
                // Ignorar erros, pois é esperado que alguns processos não existam
            }
        });
        
        console.log('✅ Cleanup de processos específicos concluído\n');
    } catch (e) {
        console.log('⚠️ Cleanup parcial de processos');
    }
}

// Função para resolver problemas de permissões no OneDrive
async function fixOneDrivePermissions() {
    console.log('🔧 Resolvendo problemas de permissões do OneDrive...');
    try {
        const electronDir = process.cwd();
        
        // 1. Remover pasta dist-installer2 completamente
        if (fs.existsSync('dist-installer2')) {
            console.log('🗑️ Removendo pasta de build anterior...');
            try {
                execSync('rmdir /S /Q dist-installer2', { stdio: 'pipe', timeout: 10000 });
            } catch (e) {
                try {
                    execSync('rm -rf dist-installer2', { stdio: 'pipe', timeout: 10000 });
                } catch (e2) {
                    console.log('⚠️ Remoção manual necessária');
                }
            }
        }
        
        // 2. Aguardar um pouco para o OneDrive processar
        console.log('⏳ Aguardando sincronização OneDrive...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 3. Criar nova pasta dist-installer2 com permissões corretas
        console.log('📁 Criando nova pasta de build...');
        fs.mkdirSync('dist-installer2', { recursive: true });
        
        // 4. Definir variável para evitar conflitos do OneDrive
        process.env.ELECTRON_BUILDER_OUTPUT_DIR = path.resolve('dist-installer2');
        
        console.log('✅ Permissões corrigidas\n');
    } catch (e) {
        console.log('⚠️ Correção parcial de permissões:', e.message);
    }
}

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
            maxBuffer: 1024 * 1024 * 100, // 100MB buffer
            timeout: options.timeout || 300000, // 5 minutos padrão
            ...options
        });
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ ${description} concluído em ${duration}s\n`);
        return result;
    } catch (error) {
        console.error(`❌ Erro em: ${description}`);
        console.error(`💥 Comando falhou: ${command}`);
        console.error(`📝 Erro: ${error.message}\n`);
        throw error;
    }
}

// Função para executar comando de forma assíncrona com timeout e monitoramento
function runCommandAsync(command, description, timeoutMinutes = 30) {
    return new Promise((resolve, reject) => {
        console.log(`📋 ${description}...`);
        console.log(`💻 Executando: ${command}`);
        console.log(`⏱️ Timeout: ${timeoutMinutes} minutos\n`);
        
        const startTime = Date.now();
        
        // Configurar variáveis de ambiente para otimização
        const env = {
            ...process.env,
            ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES: 'true',
            ELECTRON_BUILDER_COMPRESSION_LEVEL: '1',
            DEBUG: '',
            NODE_OPTIONS: '--max-old-space-size=8192', // 8GB para Node.js
            ELECTRON_BUILDER_OUTPUT_DIR: path.resolve('dist-installer2'),
            // Evitar conflitos do OneDrive
            ELECTRON_BUILDER_CACHE: path.resolve('node_modules/.cache/electron-builder'),
            npm_config_cache: path.resolve('node_modules/.cache/npm')
        };
        
        const child = spawn(command, [], { 
            stdio: 'inherit', 
            shell: true,
            cwd: process.cwd(),
            env: env
        });

        const timeout = setTimeout(() => {
            console.log('⏰ Timeout atingido, finalizando processo...');
            child.kill('SIGTERM');
            setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error(`Timeout de ${timeoutMinutes} minutos atingido para: ${description}`));
            }, 10000);
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
        // 0. Preparação inicial - matar apenas processos específicos
        killHangingProcesses();
        await fixOneDrivePermissions();
        
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

        // 2. Verificar arquivos necessários
        console.log('🔍 Verificando arquivos necessários...');
        const requiredFiles = [
            '../backend-spring/target/backend-spring-0.0.1-SNAPSHOT.jar',
            'icon/icon.ico'
        ];
        
        for (const file of requiredFiles) {
            if (!fs.existsSync(file)) {
                console.error(`❌ Arquivo necessário não encontrado: ${file}`);
                process.exit(1);
            }
        }
        console.log('✅ Todos os arquivos necessários encontrados\n');

        // 3. Build do Electron (TypeScript) - já foi feito no build:prod
        if (!fs.existsSync('dist/main.js')) {
            runCommand('npm run build', 'Compilando Electron TypeScript');
        }

        // 4. Criar deploy package
        runCommand('node ../scripts/create-deploy-package.js', 'Criando pacote de deploy');

        // 5. Copiar base de dados
        console.log('📊 Copiando base de dados...');
        runCommand('node ../scripts/copy-db-for-build.js', 'Copiando base de dados para produção');

        // 6. Verificar e copiar recursos visuais
        console.log('🖼️ Verificando recursos visuais...');
        
        // Logo
        const logoSrc = '../backend-spring/uploads/logo.png';
        const logoDestProduction = 'resources/backend-spring/uploads/logo.png';
        if (fs.existsSync(logoSrc)) {
            const logoDestDir = path.dirname(logoDestProduction);
            if (!fs.existsSync(logoDestDir)) {
                fs.mkdirSync(logoDestDir, { recursive: true });
            }
            fs.copyFileSync(logoSrc, logoDestProduction);
            console.log('✅ Logo copiado para produção');
        }
        
        // Imagem padrão
        const defaultImageSrc = '../frontend/shared/padrao.png';
        const defaultImageDest = 'resources/backend-spring/uploads/produtos/padrao.png';
        if (fs.existsSync(defaultImageSrc)) {
            const destDir = path.dirname(defaultImageDest);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }
            fs.copyFileSync(defaultImageSrc, defaultImageDest);
            console.log('✅ Imagem padrão copiada');
        }
        console.log();

        // 7. Aguardar OneDrive sincronizar antes do build
        console.log('⏳ Aguardando estabilização OneDrive...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 8. Electron-builder com configuração super otimizada
        console.log('📦 Iniciando empacotamento OTIMIZADO...');
        console.log('⚠️  Esta etapa pode demorar 20-30 minutos');
        console.log('💡 Usando configuração otimizada para OneDrive...\n');
        
        // Tentar build com configurações específicas para OneDrive
        await runCommandAsync(
            'npx electron-builder --win --config.compression=store --config.nsis.warningsAsErrors=false --config.nsis.differentialPackage=false --config.directories.output=dist-installer2', 
            'Criando instalador Windows - OTIMIZADO',
            30 // 30 minutos de timeout
        );

        // 9. Verificar resultado
        console.log('🎉 BUILD CONCLUÍDO COM SUCESSO!');
        console.log('📦 Verificando arquivos gerados...');
        
        if (fs.existsSync('dist-installer2')) {
            const files = fs.readdirSync('dist-installer2');
            let hasInstaller = false;
            
            files.forEach(file => {
                console.log(`📄 ${file}`);
                if (file.endsWith('.exe')) {
                    const stats = fs.statSync(`dist-installer2/${file}`);
                    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
                    console.log(`   ✅ Instalador: ${file} (${sizeMB} MB)`);
                    hasInstaller = true;
                }
            });
            
            if (hasInstaller) {
                console.log('\n✨ SUCESSO! Instalador criado e pronto para distribuição!');
            } else {
                console.log('\n⚠️ Build concluído mas instalador não encontrado');
            }
        } else {
            console.log('\n⚠️ Pasta de output não encontrada');
        }

        // 10. Deploy automático (opcional)
        try {
            runCommand('node ../scripts/maybe_auto_deploy.js', 'Verificando auto-deploy');
        } catch (e) {
            console.log('⚠️ Auto-deploy falhou (não crítico):', e.message);
        }

    } catch (error) {
        console.error('\n❌ BUILD FALHOU!');
        console.error('💥 Erro:', error.message);
        console.error('\n🔧 Soluções possíveis:');
        console.error('   • Execute como administrador');
        console.error('   • Pause o OneDrive temporariamente');
        console.error('   • Mova o projeto para uma pasta local (não OneDrive)');
        console.error('   • Execute: taskkill /F /IM OneDrive.exe');
        
        process.exit(1);
    }
}

main();
