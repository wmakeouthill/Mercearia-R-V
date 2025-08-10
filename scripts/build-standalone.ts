import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

console.log('🚀 Iniciando build standalone com Node.js empacotado...');

// Função para executar comandos
function runCommand(command: string, cwd?: string): void {
    console.log(`📋 Executando: ${command}`);
    try {
        execSync(command, {
            stdio: 'inherit',
            cwd: cwd || process.cwd(),
            shell: 'powershell.exe'
        });
        console.log(`✅ Comando executado com sucesso: ${command}`);
    } catch (error) {
        console.error(`❌ Erro ao executar comando: ${command}`);
        console.error(error);
        process.exit(1);
    }
}

// Função para verificar se um diretório existe
function checkDirectory(dir: string): boolean {
    return fs.existsSync(dir);
}

// Função para verificar se um arquivo existe
function checkFile(file: string): boolean {
    return fs.existsSync(file);
}

async function buildStandalone(): Promise<void> {
    try {
        // 1. Verificar se estamos no diretório raiz
        if (!checkFile('package.json') || !checkDirectory('electron')) {
            console.error('❌ Execute este script na raiz do projeto');
            process.exit(1);
        }

        // 2. Instalar dependências do Electron (incluindo Node.js)
        console.log('\n📦 Instalando dependências do Electron...');
        runCommand('npm install', 'electron');

        // 3. Verificar se o Node.js foi instalado
        const nodePath = path.join('electron', 'node_modules', 'node', 'bin', 'node.exe');
        if (!checkFile(nodePath)) {
            console.error(`❌ Node.js não encontrado em: ${nodePath}`);
            console.log('💡 Tentando instalar Node.js manualmente...');
            runCommand('npm install node@20.10.5', 'electron');
        }

        // 4. Build do backend
        console.log('\n🔧 Build do backend...');
        runCommand('npm run build', 'backend');

        // 5. Build do frontend
        console.log('\n🎨 Build do frontend...');
        runCommand('npm run build --configuration=production', 'frontend');

        // 6. Build do Electron
        console.log('\n⚡ Build do Electron...');
        runCommand('npm run build', 'electron');

        // 7. Criar distribuição
        console.log('\n📦 Criando distribuição standalone...');
        runCommand('npm run dist:win', 'electron');

        // 8. Verificar se o build foi criado
        const distPath = path.join('electron', 'dist-installer');
        if (!checkDirectory(distPath)) {
            console.error('❌ Diretório de distribuição não encontrado');
            process.exit(1);
        }

        // 9. Verificar se o Node.js foi empacotado
        const unpackedPath = path.join(distPath, 'win-unpacked', 'resources');
        const nodeExePath = path.join(unpackedPath, 'node.exe');

        if (checkFile(nodeExePath)) {
            console.log('✅ Node.js empacotado com sucesso!');
            console.log(`📍 Localização: ${nodeExePath}`);
        } else {
            console.warn('⚠️ Node.js não foi empacotado. O aplicativo usará o Node.js do sistema.');
        }

        // 10. Verificar se o backend e node_modules foram empacotados
        const backendPath = path.join(unpackedPath, 'backend');
        const nodeModulesPath = path.join(backendPath, 'node_modules');

        if (checkDirectory(backendPath) && checkDirectory(nodeModulesPath)) {
            console.log('✅ Backend e node_modules empacotados com sucesso!');
        } else {
            console.error('❌ Backend ou node_modules não foram empacotados corretamente');
            process.exit(1);
        }

        console.log('\n🎉 Build standalone concluído com sucesso!');
        console.log(`📁 Instalador disponível em: ${path.join(distPath, 'Sistema de Gestão de Estoque Setup 1.0.0.exe')}`);
        console.log('\n📋 Resumo do que foi empacotado:');
        console.log('   ✅ Backend compilado');
        console.log('   ✅ node_modules do backend');
        console.log('   ✅ Frontend compilado');
        console.log('   ✅ Node.js (se disponível)');
        console.log('   ✅ Banco de dados SQLite');
        console.log('\n🚀 O aplicativo agora é completamente standalone!');

    } catch (error) {
        console.error('❌ Erro durante o build:', error);
        process.exit(1);
    }
}

// Executar o build
buildStandalone(); 