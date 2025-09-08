/**
 * Script para baixar msvcp140.dll sem precisar instalar Visual C++ Runtime
 * Solução standalone para dependências C++
 */
const fs = require('fs');
const path = require('path');

console.log('📦 DOWNLOAD: msvcp140.dll (Visual C++ Runtime)\n');

const pgWinDir = path.join(__dirname, '..', 'backend-spring', 'pg', 'win');
const msvcpDll = path.join(pgWinDir, 'msvcp140.dll');

console.log('🎯 Target: msvcp140.dll');
console.log('📁 Destino:', msvcpDll);

if (fs.existsSync(msvcpDll)) {
    console.log('✅ msvcp140.dll já existe!');
    const stats = fs.statSync(msvcpDll);
    console.log(`   Tamanho: ${(stats.size / 1024).toFixed(1)} KB`);
    process.exit(0);
}

console.log('\n🔧 MÉTODOS PARA OBTER msvcp140.dll:\n');

console.log('MÉTODO 1 - PowerShell Download Direto:');
console.log('Execute no PowerShell como Administrador:');
console.log(`
# Baixar msvcp140.dll de fonte confiável
$url = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
$installer = "$env:TEMP\\vc_redist.x64.exe"
$extractDir = "$env:TEMP\\vcredist_extract"

Write-Host "Baixando Visual C++ Redistributable..."
Invoke-WebRequest -Uri $url -OutFile $installer

Write-Host "Extraindo arquivos..."
Start-Process -FilePath $installer -ArgumentList "/extract:$extractDir", "/quiet" -Wait

Write-Host "Procurando msvcp140.dll..."
$dllPath = Get-ChildItem -Path $extractDir -Name "msvcp140.dll" -Recurse | Select-Object -First 1
if ($dllPath) {
    $sourceDll = Join-Path $extractDir $dllPath
    Copy-Item $sourceDll "${msvcpDll.replace(/\\/g, '\\\\')}"
    Write-Host "✅ msvcp140.dll copiado com sucesso!"
} else {
    Write-Host "❌ msvcp140.dll não encontrado no pacote"
}

Write-Host "Limpando arquivos temporários..."
Remove-Item $installer -Force
Remove-Item $extractDir -Recurse -Force
`);

console.log('\nMÉTODO 2 - Copiar de Sistema Existente:');
console.log('Se você tem Visual C++ instalado, copie de:');
console.log('• C:\\Windows\\System32\\msvcp140.dll');
console.log('• C:\\Windows\\SysWOW64\\msvcp140.dll (versão 32-bit)');
console.log(`Para: ${msvcpDll}\n`);

console.log('MÉTODO 3 - Download de NuGet Package:');
console.log('PowerShell alternativo:');
console.log(`
# Usar NuGet para baixar Microsoft.VCRedist.x64
$nugetUrl = "https://www.nuget.org/api/v2/package/Microsoft.VCRedist.x64/14.38.33135"
$nugetZip = "$env:TEMP\\vcredist.zip"
$extractDir = "$env:TEMP\\nuget_extract"

Invoke-WebRequest -Uri $nugetUrl -OutFile $nugetZip
Expand-Archive -Path $nugetZip -DestinationPath $extractDir -Force

# Procurar e copiar DLL
$dllFiles = Get-ChildItem -Path $extractDir -Name "msvcp140.dll" -Recurse
if ($dllFiles) {
    Copy-Item $dllFiles[0].FullName "${msvcpDll.replace(/\\/g, '\\\\')}"
    Write-Host "✅ msvcp140.dll instalado via NuGet!"
}

Remove-Item $nugetZip -Force
Remove-Item $extractDir -Recurse -Force
`);

console.log('\nMÉTODO 4 - Download Manual Seguro:');
console.log('1. Baixe de: https://aka.ms/vs/17/release/vc_redist.x64.exe');
console.log('2. Execute o instalador (instala no sistema)');
console.log('3. Copie de C:\\Windows\\System32\\msvcp140.dll');
console.log(`4. Cole em: ${pgWinDir}\\msvcp140.dll\n`);

// Verificar outras DLLs relacionadas que podem ser necessárias
console.log('🔍 OUTRAS DLLS RELACIONADAS QUE PODE PRECISAR:\n');

const relatedDlls = [
    { name: 'vcruntime140.dll', required: true },
    { name: 'vcruntime140_1.dll', required: true },
    { name: 'msvcp140.dll', required: true },
    { name: 'concrt140.dll', required: false },
    { name: 'vccorlib140.dll', required: false }
];

relatedDlls.forEach(dll => {
    const dllPath = path.join(pgWinDir, dll.name);
    const exists = fs.existsSync(dllPath);
    const status = exists ? '✅' : (dll.required ? '❌ FALTA' : '⚪ OPCIONAL');
    console.log(`${status} ${dll.name}`);
});

console.log('\n💡 DICA IMPORTANTE:');
console.log('• msvcp140.dll deve ter ~600KB');
console.log('• Certifique-se de usar versão 64-bit');
console.log('• Teste após copiar: dir "' + pgWinDir + '\\msvcp140.dll"');

console.log('\n🎯 SCRIPT COMPLETO POWERSHELL - COPIE E EXECUTE:');
console.log(`
# ========================================
# DOWNLOAD COMPLETO: postgres.exe + msvcp140.dll
# Execute no PowerShell como Administrador
# ========================================

Write-Host "🚀 Iniciando download de dependências PostgreSQL..."

# 1. Download postgres.exe
Write-Host "📥 Baixando postgres.exe..."
$pgUrl = "https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip"
$pgZip = "$env:TEMP\\postgresql.zip"
$pgExtract = "$env:TEMP\\postgresql"
$pgTarget = "${pgWinDir.replace(/\\/g, '\\\\')}\\\\postgres.exe"

Invoke-WebRequest -Uri $pgUrl -OutFile $pgZip
Expand-Archive -Path $pgZip -DestinationPath $pgExtract -Force
Copy-Item "$pgExtract\\\\pgsql\\\\bin\\\\postgres.exe" $pgTarget
Remove-Item $pgZip, $pgExtract -Recurse -Force
Write-Host "✅ postgres.exe instalado!"

# 2. Download msvcp140.dll
Write-Host "📥 Baixando msvcp140.dll..."
$vcUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe"  
$vcExe = "$env:TEMP\\\\vc_redist.x64.exe"
$msvcpTarget = "${pgWinDir.replace(/\\/g, '\\\\')}\\\\msvcp140.dll"

# Tentar copiar do sistema primeiro
if (Test-Path "C:\\\\Windows\\\\System32\\\\msvcp140.dll") {
    Copy-Item "C:\\\\Windows\\\\System32\\\\msvcp140.dll" $msvcpTarget
    Write-Host "✅ msvcp140.dll copiado do sistema!"
} else {
    # Baixar e instalar VC++ Redistributable
    Invoke-WebRequest -Uri $vcUrl -OutFile $vcExe
    Start-Process -FilePath $vcExe -ArgumentList "/install", "/quiet", "/norestart" -Wait
    
    # Copiar após instalação
    if (Test-Path "C:\\\\Windows\\\\System32\\\\msvcp140.dll") {
        Copy-Item "C:\\\\Windows\\\\System32\\\\msvcp140.dll" $msvcpTarget
        Write-Host "✅ msvcp140.dll instalado e copiado!"
    }
    
    Remove-Item $vcExe -Force
}

Write-Host "🎉 CONCLUÍDO! Todas as dependências instaladas."
Write-Host "Execute: node scripts/check-deployment-dependencies.js"
`);

console.log('\n⚡ APÓS EXECUÇÃO:');
console.log('1. Verifique se ambos arquivos existem');
console.log('2. Execute: node scripts/check-deployment-dependencies.js');  
console.log('3. Teste: npm run dev');
