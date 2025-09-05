#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Monitor de progresso do build
function monitorBuildProgress() {
    const electronDir = path.join(__dirname, '../electron');
    const distDir = path.join(electronDir, 'dist-installer2');
    
    console.log('👀 Monitorando progresso do build...\n');
    
    const checkInterval = setInterval(() => {
        try {
            // Verificar se o diretório dist existe
            if (fs.existsSync(distDir)) {
                const files = fs.readdirSync(distDir);
                console.log(`📁 Arquivos em dist-installer2: ${files.length}`);
                
                // Verificar arquivos específicos
                const setupFile = files.find(f => f.includes('Setup') && f.endsWith('.exe'));
                const winUnpacked = files.includes('win-unpacked');
                
                if (setupFile) {
                    const setupPath = path.join(distDir, setupFile);
                    const stats = fs.statSync(setupPath);
                    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
                    console.log(`✅ Instalador encontrado: ${setupFile} (${sizeMB} MB)`);
                    console.log('🎉 Build concluído com sucesso!');
                    clearInterval(checkInterval);
                    process.exit(0);
                }
                
                if (winUnpacked) {
                    console.log('📦 Pasta win-unpacked criada, empacotamento em progresso...');
                }
            } else {
                console.log('⏳ Aguardando início do empacotamento...');
            }
        } catch (error) {
            console.log('⚠️ Erro ao monitorar:', error.message);
        }
    }, 10000); // Check a cada 10 segundos
    
    // Timeout de 30 minutos
    setTimeout(() => {
        clearInterval(checkInterval);
        console.log('⏰ Timeout atingido após 30 minutos');
        console.log('❌ Build pode ter travado ou está demorando muito');
        process.exit(1);
    }, 30 * 60 * 1000);
}

if (require.main === module) {
    monitorBuildProgress();
}

module.exports = { monitorBuildProgress };
