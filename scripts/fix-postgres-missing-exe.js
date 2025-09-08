/**
 * Script para corrigir o problema do postgres.exe ausente
 * Este é o principal motivo dos OverlappingFileLockException
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

console.log('🔧 CORREÇÃO: PostgreSQL postgres.exe ausente\n');

const pgWinDir = path.join(__dirname, '..', 'backend-spring', 'pg', 'win');
const postgresExe = path.join(pgWinDir, 'postgres.exe');

console.log('📁 Diretório PostgreSQL:', pgWinDir);
console.log('🔍 Verificando postgres.exe...');

if (fs.existsSync(postgresExe)) {
    console.log('✅ postgres.exe já existe!');
    const stats = fs.statSync(postgresExe);
    console.log(`   Tamanho: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
    console.log(`   Modificado: ${stats.mtime}`);
    process.exit(0);
}

console.log('❌ postgres.exe NÃO ENCONTRADO!');
console.log('   Este é o motivo dos erros OverlappingFileLockException\n');

console.log('🔍 Verificando arquivos existentes:');
const existingExes = fs.readdirSync(pgWinDir).filter(f => f.endsWith('.exe'));
console.log('   Executáveis encontrados:', existingExes.join(', '));

// Verificar se temos a versão do PostgreSQL
const pgCtlPath = path.join(pgWinDir, 'pg_ctl.exe');
if (fs.existsSync(pgCtlPath)) {
    try {
        const versionOutput = execSync(`"${pgCtlPath}" --version`, { encoding: 'utf8' });
        console.log('   Versão PostgreSQL:', versionOutput.trim());
    } catch (e) {
        console.log('   Não foi possível determinar a versão');
    }
}

console.log('\n🎯 SOLUÇÕES POSSÍVEIS:\n');

console.log('1. SOLUÇÃO RÁPIDA - Copiar de instalação existente:');
console.log('   • Se você tem PostgreSQL instalado no seu PC:');
console.log('     copy "C:\\Program Files\\PostgreSQL\\*\\bin\\postgres.exe" "' + postgresExe + '"');
console.log('   • Ou de onde o PostgreSQL está funcionando no seu ambiente\n');

console.log('2. SOLUÇÃO COMPLETA - Download oficial:');
console.log('   • Baixe PostgreSQL portable/binários do site oficial');
console.log('   • Extraia apenas o postgres.exe para: ' + pgWinDir);
console.log('   • Versão recomendada: PostgreSQL 15.x ou 16.x\n');

console.log('3. SOLUÇÃO ALTERNATIVA - Usar instalação do sistema:');
console.log('   • Configure o aplicativo para usar PostgreSQL instalado no sistema');
console.log('   • Modifique application.yml para não usar embedded PostgreSQL\n');

// Tentativa de encontrar postgres.exe no sistema
console.log('🔍 Procurando postgres.exe no sistema...\n');

const commonPaths = [
    'C:\\Program Files\\PostgreSQL',
    'C:\\Program Files (x86)\\PostgreSQL',
    'C:\\PostgreSQL',
    process.env.APPDATA ? path.join(process.env.APPDATA, 'postgresql') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'postgresql') : null
].filter(Boolean);

let foundPostgres = [];

for (const searchPath of commonPaths) {
    try {
        if (fs.existsSync(searchPath)) {
            const found = findPostgresExe(searchPath);
            foundPostgres = foundPostgres.concat(found);
        }
    } catch (e) {
        // Ignore errors in search
    }
}

if (foundPostgres.length > 0) {
    console.log('✅ PostgreSQL encontrado no sistema:');
    foundPostgres.forEach((pgPath, i) => {
        console.log(`   ${i + 1}. ${pgPath}`);
    });
    
    console.log('\n💡 COMANDO PARA COPIAR (escolha um dos caminhos acima):');
    console.log(`copy "${foundPostgres[0]}" "${postgresExe}"`);
    console.log('\n⚠️  Execute este comando como administrador!');
} else {
    console.log('❌ Nenhuma instalação PostgreSQL encontrada no sistema');
    
    console.log('\n📥 DOWNLOAD NECESSÁRIO:');
    console.log('   1. Vá para: https://www.postgresql.org/download/windows/');
    console.log('   2. Baixe "Binary packages" (não installer)');
    console.log('   3. Extraia postgres.exe para: ' + pgWinDir);
}

console.log('\n🚨 DEPOIS DE CORRIGIR:');
console.log('   1. Execute novamente: node scripts/check-deployment-dependencies.js');
console.log('   2. Execute limpeza: node scripts/cleanup-selective.js');  
console.log('   3. Teste o aplicativo');

function findPostgresExe(dir) {
    const found = [];
    try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                // Recursivo para subdiretórios
                const subFound = findPostgresExe(fullPath);
                found.push(...subFound);
            } else if (item === 'postgres.exe') {
                found.push(fullPath);
            }
        }
    } catch (e) {
        // Ignore permission errors
    }
    return found;
}
