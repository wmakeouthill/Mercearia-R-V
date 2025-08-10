// Script de build para o projeto raiz
import { execSync } from 'child_process';
import * as path from 'path';

console.log('🚀 Iniciando build do projeto...');

try {
    // Build do backend
    console.log('📦 Build do backend...');
    execSync('cd backend && npm run build', { stdio: 'inherit' });

    // Build do frontend
    console.log('🌐 Build do frontend...');
    execSync('cd frontend && npm run build -- --configuration=production', { stdio: 'inherit' });

    // Build do electron
    console.log('⚡ Build do electron...');
    execSync('cd electron && npm run build', { stdio: 'inherit' });

    console.log('✅ Build concluído com sucesso!');
} catch (error) {
    console.error('❌ Erro durante o build:', error);
    process.exit(1);
} 