// Script de build para produção com configurações específicas
// OTIMIZADO: Remove dependências desnecessárias e usa Node.js do sistema
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

console.log('🚀 Iniciando build de PRODUÇÃO OTIMIZADO...');
console.log('💡 Este build usará o Node.js do sistema para melhor performance');

try {
    // Verificar se Node.js está disponível no sistema
    console.log('🔍 Verificando Node.js do sistema...');
    try {
        const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
        console.log(`✅ Node.js encontrado: ${nodeVersion}`);
    } catch {
        console.error('❌ Node.js não encontrado no sistema!');
        console.error('💡 Instale Node.js no sistema para melhor performance');
        process.exit(1);
    }

    // Definir variáveis de ambiente para produção
    process.env.NODE_ENV = 'production';

    // Limpar builds anteriores
    console.log('🧹 Limpando builds anteriores...');

    const backendDist = path.join(__dirname, '../backend/dist');
    const frontendDist = path.join(__dirname, '../frontend/dist');
    const electronDist = path.join(__dirname, '../electron/dist');

    // Remover diretórios se existirem
    [backendDist, frontendDist, electronDist].forEach(dir => {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
            console.log(`  ✅ Removido: ${dir}`);
        }
    });

    // Build do backend SPRING (gera JAR)
    console.log('📦 Build do backend Spring...');
    execSync('mvn -q -DskipTests package', {
        stdio: 'inherit',
        cwd: path.join(__dirname, '../backend-spring'),
        env: { ...process.env, NODE_ENV: 'production' },
        shell: 'powershell.exe'
    });

    // Build do frontend em produção
    console.log('🌐 Build do frontend em produção...');
    execSync('npm run build -- --configuration=production', {
        stdio: 'inherit',
        cwd: path.join(__dirname, '../frontend'),
        env: { ...process.env, NODE_ENV: 'production' },
        shell: 'powershell.exe'
    });

    // Verificar se o build do frontend foi criado corretamente
    const frontendBuildPath = path.join(__dirname, '../frontend/dist/sistema-estoque/browser');
    if (!fs.existsSync(frontendBuildPath)) {
        throw new Error('Build do frontend não foi encontrado em: ' + frontendBuildPath);
    }
    console.log('  ✅ Frontend build verificado em:', frontendBuildPath);

    // Build do electron
    console.log('⚡ Build do electron...');
    execSync('npm run build', {
        stdio: 'inherit',
        cwd: path.join(__dirname, '../electron'),
        env: { ...process.env, NODE_ENV: 'production' },
        shell: 'powershell.exe'
    });

    // Limpeza de arquivos desnecessários do backend
    console.log('🧹 Limpando arquivos desnecessários do backend...');
    const backendNodeModulesPath = path.join(__dirname, '../backend/node_modules');
    if (fs.existsSync(backendNodeModulesPath)) {
        // Apenas log; variáveis não utilizadas removidas para evitar alerta do Sonar
        console.log('  ✅ Configurações de limpeza aplicadas no electron-builder');
    }

    console.log('✅ Build de PRODUÇÃO OTIMIZADO concluído com sucesso!');
    console.log('📋 Resumo:');
    console.log('  - Backend: /backend-spring/target/backend-spring-0.0.1-SNAPSHOT.jar');
    console.log('  - Frontend: /frontend/dist/sistema-estoque/browser');
    console.log('  - Electron: /electron/dist');
    console.log('  - Node.js: Usando do sistema para melhor performance');
    console.log('  - Tamanho: Reduzido através de limpeza de dependências');

} catch (error) {
    console.error('❌ Erro durante o build de produção:', error);
    process.exit(1);
}