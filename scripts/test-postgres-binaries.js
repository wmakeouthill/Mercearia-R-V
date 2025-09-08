/**
 * Script para testar se os binários PostgreSQL locais serão utilizados corretamente
 * Simula o ambiente de produção empacotado
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🧪 TESTE: Verificação de binários PostgreSQL locais\n');

const baseDir = path.join(__dirname, '..');
const pgWinDir = path.join(baseDir, 'backend-spring', 'pg', 'win');
const backendJar = path.join(baseDir, 'backend-spring', 'target', 'backend-spring-0.0.1-SNAPSHOT.jar');

console.log('=== 1. VERIFICAÇÃO DE ARQUIVOS ESSENCIAIS ===');

// Verificar JAR
if (fs.existsSync(backendJar)) {
    const stats = fs.statSync(backendJar);
    console.log(`✅ Backend JAR: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
} else {
    console.log('❌ Backend JAR não encontrado');
    process.exit(1);
}

// Verificar postgres.exe
const postgresExe = path.join(pgWinDir, 'postgres.exe');
if (fs.existsSync(postgresExe)) {
    const stats = fs.statSync(postgresExe);
    console.log(`✅ postgres.exe: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
} else {
    console.log('❌ postgres.exe não encontrado');
    process.exit(1);
}

// Verificar DLLs críticas
const criticalDlls = ['libpq.dll', 'vcruntime140.dll', 'msvcp140.dll', 'vcruntime140_1.dll'];
let dllsOk = 0;

criticalDlls.forEach(dll => {
    const dllPath = path.join(pgWinDir, dll);
    if (fs.existsSync(dllPath)) {
        const stats = fs.statSync(dllPath);
        console.log(`✅ ${dll}: ${(stats.size / 1024).toFixed(1)} KB`);
        dllsOk++;
    } else {
        console.log(`❌ ${dll}: AUSENTE`);
    }
});

console.log(`\n📊 Status DLLs: ${dllsOk}/${criticalDlls.length} presentes`);

console.log('\n=== 2. TESTE DE INICIALIZAÇÃO SIMULADO ===');

// Simular ambiente de produção
process.env.APP_PACKAGED = 'true';
process.env.NODE_ENV = 'production';

console.log('🔧 Variáveis de ambiente configuradas:');
console.log('   - APP_PACKAGED=true');
console.log('   - NODE_ENV=production');

console.log('\n=== 3. COMANDO JAVA PARA TESTE MANUAL ===');

const javaCmd = `java -jar "${backendJar}" --server.port=3001 --spring.profiles.active=slow-pc`;
console.log('Execute este comando para testar manualmente:');
console.log(`cd "${path.join(baseDir, 'backend-spring')}"`);
console.log(`set APP_PACKAGED=true`);
console.log(`set NODE_ENV=production`);
console.log(javaCmd);

console.log('\n=== 4. VERIFICAR LOGS ===');
console.log('Procure por estas mensagens nos logs:');
console.log('✅ "PRODUÇÃO: Binários PostgreSQL locais encontrados"');
console.log('✅ "Binários PostgreSQL locais configurados"');
console.log('✅ "DLL essencial encontrada: libpq.dll"');
console.log('✅ "DLL essencial encontrada: msvcp140.dll"');

console.log('\n=== 5. ESTRUTURA ESPERADA NO INSTALADOR ===');
console.log('win-unpacked/');
console.log('├── Sistema de Gestão.exe');
console.log('└── resources/');
console.log('    ├── backend-spring/');
console.log('    │   ├── backend-spring-0.0.1-SNAPSHOT.jar');
console.log('    │   └── pg/');
console.log('    │       └── win/');
console.log('    │           ├── postgres.exe         ✅');
console.log('    │           ├── libpq.dll           ✅');
console.log('    │           ├── msvcp140.dll        ✅');
console.log('    │           └── vcruntime140*.dll   ✅');
console.log('    └── data/');
console.log('        └── pg/                    # Dados criados em runtime');

if (dllsOk === criticalDlls.length) {
    console.log('\n🎉 TESTE PASSOU! Todos os recursos essenciais estão presentes.');
    console.log('📋 Próximo passo: Gerar instalador (npm run dist:win) e testar em máquina virtual');
} else {
    console.log('\n⚠️  TESTE FALHOU! Recursos essenciais ausentes.');
    console.log('📋 Corrija os arquivos ausentes antes de gerar o instalador');
}

console.log('\n=== 6. TROUBLESHOOTING ===');
console.log('Se ainda der OverlappingFileLockException:');
console.log('• Verifique se todos os arquivos .dll foram copiados');
console.log('• Execute como Administrador na primeira vez');
console.log('• Desative temporariamente o antivírus');
console.log('• Verifique permissões da pasta de dados');
