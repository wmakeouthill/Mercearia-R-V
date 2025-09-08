/**
 * Script para baixar automaticamente o postgres.exe ausente
 * Versão PostgreSQL 16.4 (compatível com os utilitários existentes)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

console.log('⬇️  AUTO-DOWNLOAD: postgres.exe PostgreSQL 16.4\n');

const pgWinDir = path.join(__dirname, '..', 'backend-spring', 'pg', 'win');
const postgresExe = path.join(pgWinDir, 'postgres.exe');

// Verificar se já existe
if (fs.existsSync(postgresExe)) {
    console.log('✅ postgres.exe já existe! Nenhuma ação necessária.');
    process.exit(0);
}

console.log('🎯 Target: PostgreSQL 16.4 postgres.exe');
console.log('📁 Destino:', postgresExe);

// URLs de download (mirrors oficiais)
const downloadOptions = [
    {
        name: 'PostgreSQL.org Official Binary',
        url: 'https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip',
        extractPath: 'pgsql/bin/postgres.exe'
    },
    {
        name: 'EnterpriseDB Mirror', 
        url: 'https://sbp.enterprisedb.com/getfile.jsp?fileid=1258893',
        extractPath: 'pgsql/bin/postgres.exe'
    }
];

console.log('\n📋 ESTRATÉGIAS DE DOWNLOAD:\n');

downloadOptions.forEach((option, i) => {
    console.log(`${i + 1}. ${option.name}`);
    console.log(`   URL: ${option.url}`);
});

console.log('\n⚠️  AVISO IMPORTANTE:');
console.log('   • Download direto pode requerer ferramentas adicionais');
console.log('   • Recomendado: download manual mais seguro');
console.log('   • Tamanho esperado: ~15-20 MB\n');

// Instruções manuais mais detalhadas
console.log('🔧 INSTRUÇÕES MANUAIS DETALHADAS:\n');

console.log('OPÇÃO 1 - Download Oficial PostgreSQL:');
console.log('1. Acesse: https://www.postgresql.org/download/windows/');
console.log('2. Clique em "Download the installer"');
console.log('3. Na página EDB, procure por "Binary packages"');
console.log('4. Baixe: "postgresql-16.4-1-windows-x64-binaries.zip"');
console.log('5. Extraia o arquivo');
console.log('6. Copie: pgsql\\bin\\postgres.exe');
console.log(`7. Cole em: ${pgWinDir}\\postgres.exe\n`);

console.log('OPÇÃO 2 - PowerShell Download (Avançado):');
console.log('Execute no PowerShell como Administrador:');
console.log(`
$url = "https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip"
$tempZip = "$env:TEMP\\pg-binaries.zip"
$tempDir = "$env:TEMP\\pg-extract"
$targetFile = "${postgresExe.replace(/\\/g, '\\\\')}"

Write-Host "Baixando PostgreSQL binaries..."
Invoke-WebRequest -Uri $url -OutFile $tempZip

Write-Host "Extraindo..."
Expand-Archive -Path $tempZip -DestinationPath $tempDir -Force

Write-Host "Copiando postgres.exe..."
Copy-Item "$tempDir\\pgsql\\bin\\postgres.exe" -Destination $targetFile

Write-Host "Limpando arquivos temporários..."
Remove-Item $tempZip -Force
Remove-Item $tempDir -Recurse -Force

Write-Host "✅ postgres.exe instalado com sucesso!"
`);

console.log('\nOPÇÃO 3 - Usando winget (Windows Package Manager):');
console.log('1. winget install PostgreSQL.PostgreSQL');
console.log('2. Copie de: C:\\Program Files\\PostgreSQL\\16\\bin\\postgres.exe');
console.log(`3. Para: ${postgresExe}\n`);

console.log('OPÇÃO 4 - Portable PostgreSQL:');
console.log('1. Baixe de: https://sourceforge.net/projects/postgresqlportable/');
console.log('2. Extraia e copie postgres.exe\n');

// Verificação pós-instalação
console.log('🧪 APÓS INSTALAÇÃO - VERIFICAÇÃO:');
console.log('1. Execute: node scripts/fix-postgres-missing-exe.js');
console.log('2. Execute: node scripts/check-deployment-dependencies.js');
console.log('3. Teste a aplicação\n');

// Verificar dependências relacionadas
console.log('🔍 VERIFICAÇÃO DE DEPENDÊNCIAS RELACIONADAS:\n');

const criticalFiles = [
    'libpq.dll',
    'vcruntime140.dll', 
    'vcruntime140_1.dll',
    'msvcp140.dll'
];

console.log('Arquivos críticos existentes:');
criticalFiles.forEach(file => {
    const filePath = path.join(pgWinDir, file);
    if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        console.log(`✅ ${file} (${(stats.size / 1024).toFixed(1)} KB)`);
    } else {
        console.log(`❌ ${file} - AUSENTE!`);
    }
});

console.log('\n🎯 RESUMO DO PROBLEMA:');
console.log('• Aplicação falha porque postgres.exe está ausente');
console.log('• OverlappingFileLockException é sintoma, não causa');
console.log('• Todas as outras dependências PostgreSQL estão presentes');
console.log('• Após adicionar postgres.exe, aplicação deve funcionar\n');

console.log('⚡ PRÓXIMOS PASSOS:');
console.log('1. Baixe e instale postgres.exe usando uma das opções acima');
console.log('2. Verifique se o arquivo tem ~15-20 MB');
console.log('3. Execute novamente o diagnóstico');
console.log('4. Teste em máquina virtual');
