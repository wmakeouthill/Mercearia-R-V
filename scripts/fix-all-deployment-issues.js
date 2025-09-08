/**
 * SCRIPT FINAL - Correção completa para problemas de deploy
 * Identifica e resolve todos os recursos essenciais ausentes
 */
const fs = require('fs');
const path = require('path');

console.log('🛠️  CORREÇÃO COMPLETA - RECURSOS ESSENCIAIS PARA DEPLOY\n');

let issues = [];
let fixes = [];

const baseDir = path.join(__dirname, '..');
const pgWinDir = path.join(baseDir, 'backend-spring', 'pg', 'win');

// 1. Verificar postgres.exe (CRÍTICO)
console.log('=== 1. POSTGRES.EXE (CRÍTICO) ===');
const postgresExe = path.join(pgWinDir, 'postgres.exe');
if (!fs.existsSync(postgresExe)) {
    issues.push('❌ postgres.exe AUSENTE - Servidor PostgreSQL principal');
    fixes.push('• URGENTE: Baixar postgres.exe PostgreSQL 16.4');
    fixes.push('  Link: https://www.postgresql.org/download/windows/');
    fixes.push('  Extrair pgsql\\bin\\postgres.exe para: ' + pgWinDir);
    console.log('❌ CRÍTICO: postgres.exe ausente');
} else {
    const stats = fs.statSync(postgresExe);
    console.log(`✅ postgres.exe presente (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
}

// 2. Verificar msvcp140.dll (CRÍTICO)  
console.log('\n=== 2. VISUAL C++ RUNTIME (CRÍTICO) ===');
const msvcpDll = path.join(pgWinDir, 'msvcp140.dll');
if (!fs.existsSync(msvcpDll)) {
    issues.push('❌ msvcp140.dll AUSENTE - Runtime C++ essencial');
    fixes.push('• Instalar Visual C++ Redistributable 2015-2022');
    fixes.push('  Ou copiar msvcp140.dll para: ' + pgWinDir);
    console.log('❌ CRÍTICO: msvcp140.dll ausente');
} else {
    console.log('✅ msvcp140.dll presente');
}

// 3. Verificar outros runtimes
const otherRuntimes = ['vcruntime140.dll', 'vcruntime140_1.dll'];
otherRuntimes.forEach(dll => {
    const dllPath = path.join(pgWinDir, dll);
    if (fs.existsSync(dllPath)) {
        console.log(`✅ ${dll} presente`);
    } else {
        issues.push(`❌ ${dll} AUSENTE`);
        fixes.push(`• Copiar ${dll} para: ${pgWinDir}`);
    }
});

// 4. Verificar frontend build
console.log('\n=== 3. FRONTEND BUILD ===');
const frontendDist = path.join(baseDir, 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
    const files = fs.readdirSync(frontendDist, { recursive: true });
    const jsFiles = files.filter(f => f.includes('main') && f.endsWith('.js'));
    if (jsFiles.length > 0) {
        console.log(`✅ Frontend buildado (${jsFiles.length} arquivos main.js)`);
    } else {
        issues.push('❌ Frontend build incompleto');
        fixes.push('• Executar: cd frontend && npm run build');
    }
} else {
    issues.push('❌ Frontend não buildado');
    fixes.push('• Executar: cd frontend && npm run build');
}

// 5. Verificar JAR do backend
console.log('\n=== 4. BACKEND JAR ===');
const backendJar = path.join(baseDir, 'backend-spring', 'target', 'backend-spring-0.0.1-SNAPSHOT.jar');
if (fs.existsSync(backendJar)) {
    const stats = fs.statSync(backendJar);
    console.log(`✅ Backend JAR (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
} else {
    issues.push('❌ Backend JAR não buildado');
    fixes.push('• Executar: cd backend-spring && mvn clean package -DskipTests');
}

// 6. Verificar JDK embarcado
console.log('\n=== 5. JDK EMBARCADO ===');
const jdkDir = path.join(baseDir, 'electron', 'jdk-21');
const javaExe = path.join(jdkDir, 'bin', 'java.exe');
if (fs.existsSync(javaExe)) {
    console.log('✅ JDK-21 embarcado presente');
} else {
    issues.push('❌ JDK-21 embarcado ausente');
    fixes.push('• Baixar JDK-21 para: ' + jdkDir);
    fixes.push('  Link: https://adoptium.net/');
}

// 7. Verificar scripts essenciais
console.log('\n=== 6. SCRIPTS ESSENCIAIS ===');
const essentialScripts = [
    'cleanup-selective.js',
    'render-nota-pdf.js',
    'wait-and-start-electron.js'
];

essentialScripts.forEach(script => {
    const scriptPath = path.join(__dirname, script);
    if (fs.existsSync(scriptPath)) {
        console.log(`✅ ${script}`);
    } else {
        issues.push(`❌ Script essencial ausente: ${script}`);
    }
});

// RESUMO FINAL
console.log('\n' + '='.repeat(60));
console.log('📊 RESUMO FINAL');
console.log('='.repeat(60));

if (issues.length === 0) {
    console.log('🎉 PERFEITO! Todos os recursos essenciais estão presentes!');
    console.log('\n✅ APLICAÇÃO PRONTA PARA DEPLOY');
    
    console.log('\n📋 COMANDOS FINAIS RECOMENDADOS:');
    console.log('1. npm run build:all        # Build completo');
    console.log('2. node scripts/cleanup-selective.js   # Limpeza');
    console.log('3. npm run dist:win         # Gerar instalador');
    
} else {
    console.log(`❌ ENCONTRADOS ${issues.length} PROBLEMAS CRÍTICOS:\n`);
    
    issues.forEach(issue => {
        console.log(issue);
    });
    
    console.log('\n🛠️  CORREÇÕES NECESSÁRIAS:\n');
    fixes.forEach(fix => {
        console.log(fix);
    });
    
    console.log('\n⚡ PRIORIDADE DE CORREÇÃO:');
    console.log('1. 🔥 CRÍTICO: postgres.exe (resolve OverlappingFileLockException)');
    console.log('2. 🔥 CRÍTICO: msvcp140.dll (resolve dependências C++)');
    console.log('3. 🔶 IMPORTANTE: Frontend build (interface do usuário)');
    console.log('4. 🔶 IMPORTANTE: Backend JAR (lógica do servidor)');
    
    console.log('\n🎯 COMANDO RÁPIDO - POWERSHELL (Execute como Admin):');
    console.log(`
# Download automático postgres.exe
$url = "https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip"
$temp = "$env:TEMP\\pg.zip"
$extract = "$env:TEMP\\pg"
Invoke-WebRequest -Uri $url -OutFile $temp
Expand-Archive $temp $extract -Force
Copy-Item "$extract\\pgsql\\bin\\postgres.exe" "${postgresExe.replace(/\\/g, '\\\\')}"
Remove-Item $temp, $extract -Recurse -Force
Write-Host "✅ postgres.exe instalado!"
    `);
}

console.log('\n🚀 TESTE FINAL:');
console.log('   Execute na máquina virtual após correções:');
console.log('   1. node scripts/check-deployment-dependencies.js');
console.log('   2. npm run dev  # Teste local');
console.log('   3. Verifique se inicia sem OverlappingFileLockException');
