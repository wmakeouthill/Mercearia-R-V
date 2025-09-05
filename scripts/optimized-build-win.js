const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Build DEFINITIVO - Sistema de Estoque Windows\n');

const projectRoot = path.join(__dirname, '..');
const electronDir = path.join(projectRoot, 'electron');

// Função para executar comandos com tratamento de erros melhorado
function runCommand(command, description, options = {}) {
    console.log(`📋 ${description}`);
    console.log(`💻 Executando: ${command}`);
    
    if (options.timeout) {
        console.log(`⏱️ Timeout: ${Math.floor(options.timeout/60000)} minutos`);
    }
    
    try {
        const result = execSync(command, {
            cwd: options.cwd || electronDir,
            stdio: 'inherit',
            timeout: options.timeout || 35 * 60 * 1000, // 35 minutos
            maxBuffer: 1024 * 1024 * 100, // 100MB buffer
            windowsHide: true
        });
        console.log(`✅ ${description} - Concluído\n`);
        return result;
    } catch (error) {
        console.error(`❌ ${description} - FALHOU!`);
        console.error(`💥 Erro: ${error.message}`);
        
        if (error.message.includes('symbolic link') || error.message.includes('symlink')) {
            console.log('\n🔧 Execute como administrador para resolver symlinks');
        } else if (error.message.includes('não pode encontrar o arquivo')) {
            console.log('\n🔧 Problema de dependências - verificando configuração...');
        }
        console.log('');
        process.exit(1);
    }
}

// Limpeza inicial
function cleanupBuild() {
    console.log('🧹 Limpando builds anteriores...');
    
    const pathsToClean = [
        path.join(electronDir, 'dist-installer2'),
        path.join(electronDir, 'dist'),
        path.join(electronDir, 'node_modules/.cache')
    ];
    
    pathsToClean.forEach(p => {
        if (fs.existsSync(p)) {
            try {
                execSync(`rmdir /S /Q "${p}" 2>nul || rm -rf "${p}"`, { 
                    stdio: 'pipe', 
                    timeout: 10000 
                });
                console.log(`  ✅ Removido: ${p}`);
            } catch (e) {
                console.log(`  ⚠️ Não foi possível remover: ${p}`);
            }
        }
    });
}

// Verificar recursos visuais
function ensureVisualAssets() {
    console.log('🖼️ Verificando recursos visuais...');
    
    const logoSrc = path.join(projectRoot, 'backend-spring', 'uploads', 'logo.png');
    const logoDest = path.join(electronDir, 'assets', 'logo.png');
    
    const imagemPadraoSrc = path.join(projectRoot, 'frontend', 'src', 'assets', 'imagem-padrao.jpg');
    const imagemPadraoDest = path.join(electronDir, 'assets', 'imagem-padrao.jpg');
    
    // Garantir que a pasta assets existe
    const assetsDir = path.join(electronDir, 'assets');
    if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
    }
    
    // Copiar logo se existir
    if (fs.existsSync(logoSrc)) {
        fs.copyFileSync(logoSrc, logoDest);
        console.log('✅ Logo copiado para produção');
    }
    
    // Copiar imagem padrão se existir
    if (fs.existsSync(imagemPadraoSrc)) {
        fs.copyFileSync(imagemPadraoSrc, imagemPadraoDest);
        console.log('✅ Imagem padrão copiada');
    }
}

// Aguardar estabilização do OneDrive
function waitForOneDriveStability() {
    console.log('⏳ Aguardando estabilização OneDrive...');
    // Pausa de 3 segundos para OneDrive estabilizar
    return new Promise(resolve => setTimeout(resolve, 3000));
}

// Main build process
async function main() {
    try {
        // 1. Limpeza inicial
        cleanupBuild();
        
        // 2. Verificar recursos visuais
        ensureVisualAssets();
        
        // 3. Aguardar OneDrive
        await waitForOneDriveStability();
        
        // 4. Build do Electron (TypeScript)
        console.log('⚡ Compilando Electron TypeScript...');
        runCommand(
            'npm run build',
            'Compilando código TypeScript do Electron',
            { timeout: 5 * 60 * 1000 } // 5 minutos
        );
        
        // 5. Build do electron-builder com configuração otimizada
        console.log('📦 Iniciando empacotamento DEFINITIVO...');
        console.log('⚠️  Esta etapa pode demorar 20-30 minutos');
        console.log('💡 Usando configuração otimizada e corrigida...\n');
        
        const builderCommand = [
            'npx electron-builder',
            '--win',
            '--config.compression=store',
            '--config.nsis.warningsAsErrors=false',
            '--config.nsis.differentialPackage=false',
            '--config.directories.output=dist-installer2'
        ].join(' ');
        
        runCommand(
            builderCommand,
            'Criando instalador Windows - CONFIGURAÇÃO DEFINITIVA',
            { timeout: 35 * 60 * 1000 } // 35 minutos
        );
        
        // 6. Verificar resultado final
        const installerPath = path.join(electronDir, 'dist-installer2');
        if (fs.existsSync(installerPath)) {
            const files = fs.readdirSync(installerPath);
            const installerFile = files.find(f => f.endsWith('.exe'));
            
            if (installerFile) {
                const fullPath = path.join(installerPath, installerFile);
                const stats = fs.statSync(fullPath);
                const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
                
                console.log('✅ BUILD DEFINITIVO CONCLUÍDO COM SUCESSO!');
                console.log(`📋 Instalador: ${installerFile}`);
                console.log(`📐 Tamanho: ${sizeMB} MB`);
                console.log(`📁 Local: ${fullPath}`);
                console.log('🎉 Sistema pronto para distribuição!');
            } else {
                console.log('⚠️ Build concluído mas instalador .exe não encontrado');
            }
        } else {
            console.log('⚠️ Pasta de saída não encontrada');
        }
        
    } catch (error) {
        console.error('\n❌ BUILD FALHOU!');
        console.error(`💥 Erro: ${error.message}`);
        
        console.log('\n🔧 Soluções possíveis:');
        console.log('   • Execute como administrador: "Run as administrator"');
        console.log('   • Pause o OneDrive temporariamente');
        console.log('   • Mova o projeto para uma pasta local (não OneDrive)');
        console.log('   • Execute: taskkill /F /IM OneDrive.exe');
        console.log('   • Limpe o cache: rmdir /S /Q node_modules\\.cache');
        
        process.exit(1);
    }
}

// Verificar se está no diretório correto
if (!fs.existsSync(electronDir)) {
    console.error('❌ Diretório electron não encontrado!');
    console.error(`Expected: ${electronDir}`);
    process.exit(1);
}

// Executar build
main().catch(console.error);
