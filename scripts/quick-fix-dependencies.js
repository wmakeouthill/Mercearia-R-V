/**
 * SCRIPT ULTRA SIMPLIFICADO - Download completo das dependências
 * Baixa postgres.exe + msvcp140.dll em um comando só
 */

console.log('🚀 SCRIPT ULTRA-RÁPIDO: Download Completo de Dependências\n');

const pgWinDir = String.raw`C:\Mercearia R-V\backend-spring\pg\win`;

console.log('📋 O QUE ESTE SCRIPT FAZ:');
console.log('✅ Baixa postgres.exe (PostgreSQL 16.4)');
console.log('✅ Baixa/copia msvcp140.dll (Visual C++ Runtime)');
console.log('✅ Verifica se tudo foi instalado corretamente\n');

console.log('🎯 COMANDO ÚNICO - POWERSHELL:');
console.log('Copie TODO este bloco e execute no PowerShell como Admin:\n');

console.log('```powershell');
console.log(`# ====================================================
# DOWNLOAD AUTOMÁTICO - DEPENDÊNCIAS POSTGRESQL
# Execute no PowerShell como Administrador
# ====================================================

Write-Host "🚀 Baixando dependências PostgreSQL..." -ForegroundColor Green

# Definir caminhos
$pgDir = "${pgWinDir}"
$pgExe = "$pgDir\\postgres.exe"  
$msvcpDll = "$pgDir\\msvcp140.dll"

# 1. BAIXAR POSTGRES.EXE
Write-Host "📥 1/2 - Baixando postgres.exe..." -ForegroundColor Yellow
if (-not (Test-Path $pgExe)) {
    $pgUrl = "https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip"
    $pgZip = "$env:TEMP\\postgresql.zip"
    $pgExtract = "$env:TEMP\\postgresql_extract"
    
    try {
        Invoke-WebRequest -Uri $pgUrl -OutFile $pgZip -ErrorAction Stop
        Expand-Archive -Path $pgZip -DestinationPath $pgExtract -Force
        Copy-Item "$pgExtract\\pgsql\\bin\\postgres.exe" $pgExe -Force
        Remove-Item $pgZip, $pgExtract -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "✅ postgres.exe instalado com sucesso!" -ForegroundColor Green
    } catch {
        Write-Host "❌ Erro ao baixar postgres.exe: $_" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✅ postgres.exe já existe!" -ForegroundColor Green
}

# 2. BAIXAR/COPIAR MSVCP140.DLL  
Write-Host "📥 2/2 - Configurando msvcp140.dll..." -ForegroundColor Yellow
if (-not (Test-Path $msvcpDll)) {
    # Tentar copiar do sistema primeiro (mais rápido)
    $systemDll = "C:\\Windows\\System32\\msvcp140.dll"
    if (Test-Path $systemDll) {
        Copy-Item $systemDll $msvcpDll -Force
        Write-Host "✅ msvcp140.dll copiado do sistema!" -ForegroundColor Green
    } else {
        # Baixar e instalar VC++ Redistributable
        Write-Host "📦 Instalando Visual C++ Redistributable..." -ForegroundColor Yellow
        $vcUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
        $vcExe = "$env:TEMP\\vc_redist.x64.exe"
        
        try {
            Invoke-WebRequest -Uri $vcUrl -OutFile $vcExe -ErrorAction Stop
            Start-Process -FilePath $vcExe -ArgumentList "/install", "/quiet", "/norestart" -Wait -ErrorAction Stop
            
            # Copiar após instalação
            if (Test-Path $systemDll) {
                Copy-Item $systemDll $msvcpDll -Force  
                Write-Host "✅ msvcp140.dll instalado e copiado!" -ForegroundColor Green
            } else {
                Write-Host "⚠️ msvcp140.dll não encontrado após instalação" -ForegroundColor Yellow
            }
            
            Remove-Item $vcExe -Force -ErrorAction SilentlyContinue
        } catch {
            Write-Host "❌ Erro ao instalar VC++ Redistributable: $_" -ForegroundColor Red
        }
    }
} else {
    Write-Host "✅ msvcp140.dll já existe!" -ForegroundColor Green  
}

# 3. VERIFICAÇÃO FINAL
Write-Host "🔍 Verificação final..." -ForegroundColor Yellow
$success = $true

if (Test-Path $pgExe) {
    $pgSize = [math]::Round((Get-Item $pgExe).Length / 1MB, 1)
    Write-Host "✅ postgres.exe presente ($pgSize MB)" -ForegroundColor Green
} else {
    Write-Host "❌ postgres.exe ainda ausente!" -ForegroundColor Red
    $success = $false
}

if (Test-Path $msvcpDll) {
    $dllSize = [math]::Round((Get-Item $msvcpDll).Length / 1KB, 1)
    Write-Host "✅ msvcp140.dll presente ($dllSize KB)" -ForegroundColor Green
} else {
    Write-Host "❌ msvcp140.dll ainda ausente!" -ForegroundColor Red
    $success = $false
}

if ($success) {
    Write-Host ""
    Write-Host "🎉 SUCESSO! Todas as dependências foram instaladas." -ForegroundColor Green
    Write-Host "🔄 Execute agora:" -ForegroundColor Cyan
    Write-Host "   cd 'C:\\Mercearia R-V'" -ForegroundColor White
    Write-Host "   node scripts/check-deployment-dependencies.js" -ForegroundColor White
    Write-Host "   npm run dev" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "⚠️ Algumas dependências podem estar ausentes." -ForegroundColor Yellow
    Write-Host "Verifique as mensagens de erro acima." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "📋 Localização dos arquivos:" -ForegroundColor Cyan
Write-Host "• postgres.exe: $pgExe" -ForegroundColor White  
Write-Host "• msvcp140.dll: $msvcpDll" -ForegroundColor White`);

console.log('```\n');

console.log('🎯 ALTERNATIVA AINDA MAIS SIMPLES:');
console.log('Se você já tem Visual C++ instalado no seu sistema:\n');

console.log('```powershell');
console.log(`# MÉTODO SUPER RÁPIDO (se você tem VC++ instalado)
$pgDir = "${pgWinDir}"

# 1. Baixar só postgres.exe
$pgUrl = "https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip"
$pgZip = "$env:TEMP\\pg.zip"
Invoke-WebRequest -Uri $pgUrl -OutFile $pgZip
Expand-Archive $pgZip "$env:TEMP\\pg" -Force
Copy-Item "$env:TEMP\\pg\\pgsql\\bin\\postgres.exe" "$pgDir\\postgres.exe" -Force

# 2. Copiar msvcp140.dll do sistema
Copy-Item "C:\\Windows\\System32\\msvcp140.dll" "$pgDir\\msvcp140.dll" -Force

# 3. Limpar
Remove-Item $pgZip, "$env:TEMP\\pg" -Recurse -Force

Write-Host "✅ Pronto! Dependências instaladas."
`);
console.log('```\n');

console.log('⚡ VERIFICAÇÃO RÁPIDA:');
console.log(`dir "${pgWinDir}\\postgres.exe"`);
console.log(`dir "${pgWinDir}\\msvcp140.dll"`);

console.log('\n🎯 PRÓXIMOS PASSOS APÓS EXECUÇÃO:');
console.log('1. ✅ Execute: node scripts/check-deployment-dependencies.js');
console.log('2. 🧪 Teste: npm run dev');
console.log('3. 🚀 Build final: npm run dist:win');
