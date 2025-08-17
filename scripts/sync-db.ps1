param(
  [string]$SrcHost     = "localhost",
  [int]   $SrcPort     = 5432,
  [string]$SrcDb       = "mercearia_dev",
  [string]$SrcUser     = "postgres",
  [string]$SrcPass     = "",
  [string]$TargetHost  = "localhost",
  [int]   $TargetPort  = 53366,
  [string]$TargetDb    = "postgres",
  [string]$TargetUser  = "postgres",
  [string]$TargetPass  = "",
  [string]$PgBinPath   = "C:\Program Files\PostgreSQL\16\bin"
)

function Write-Note($m) { Write-Host "[sync-db] $m" }

$time = (Get-Date).ToString("yyyyMMddHHmmss")
$dumpFile = Join-Path $env:TEMP ("dbdump-$time.dump")

# Resolve pg_dump and pg_restore executables
$pgDumpExe = if (Get-Command pg_dump -ErrorAction SilentlyContinue) { "pg_dump" }
            elseif ($PgBinPath -and (Test-Path (Join-Path $PgBinPath 'pg_dump.exe'))) { (Join-Path $PgBinPath 'pg_dump.exe') }
            else { $null }

$pgRestoreExe = if (Get-Command pg_restore -ErrorAction SilentlyContinue) { "pg_restore" }
               elseif ($PgBinPath -and (Test-Path (Join-Path $PgBinPath 'pg_restore.exe'))) { (Join-Path $PgBinPath 'pg_restore.exe') }
               else { $null }

$pgIsReadyExe = if (Get-Command pg_isready -ErrorAction SilentlyContinue) { "pg_isready" }
               elseif ($PgBinPath -and (Test-Path (Join-Path $PgBinPath 'pg_isready.exe'))) { (Join-Path $PgBinPath 'pg_isready.exe') }
               else { $null }

function Test-PortOpen($hostname, $port) {
    if ($pgIsReadyExe) {
        & "$pgIsReadyExe" -h $hostname -p $port | Out-Null
        return $LASTEXITCODE -eq 0
    } else {
        $res = Test-NetConnection -ComputerName $hostname -Port $port -WarningAction SilentlyContinue
        return $res.TcpTestSucceeded
    }
}

function Find-OpenPostgresPort($hostname) {
    $candidates = @(5432)
    $candidates += (53300..53400)
    foreach ($p in $candidates) {
        if (Test-PortOpen $hostname $p) { return $p }
    }
    return $null
}

if (-not $pgDumpExe -or -not $pgRestoreExe) {
  Write-Host "[sync-db] ERRO: não foi possível localizar 'pg_dump' ou 'pg_restore'. Verifique o PATH ou informe -PgBinPath." -ForegroundColor Red
  exit 1
}

try {
  Write-Note "Criando dump de $($SrcHost):$($SrcPort)/$($SrcDb) -> $dumpFile"
  $env:PGPASSWORD = $SrcPass
  # If configured SrcPort is not open, try to auto-detect
  if (-not (Test-PortOpen $SrcHost $SrcPort)) {
    $det = Find-OpenPostgresPort $SrcHost
    if ($det) {
      Write-Note "Porta de origem $SrcPort não estava aberta. Detectado e usando porta $det para a origem."
      $SrcPort = $det
    } else {
      Write-Host "[sync-db] ERRO: não foi possível conectar na porta de origem $SrcPort e nenhuma porta alternativa foi detectada." -ForegroundColor Red
      exit 1
    }
  }

  & "$pgDumpExe" -h $SrcHost -p $SrcPort -U $SrcUser -Fc -f $dumpFile $SrcDb
  if ($LASTEXITCODE -ne 0) { throw "pg_dump falhou (exitcode $LASTEXITCODE)" }

  Write-Note "Restaurando dump para $($TargetHost):$($TargetPort)/$($TargetDb)"
  # If configured TargetPort is not open, try to auto-detect
  if (-not (Test-PortOpen $TargetHost $TargetPort)) {
    $detT = Find-OpenPostgresPort $TargetHost
    if ($detT) {
      Write-Note "Porta de destino $TargetPort não estava aberta. Detectado e usando porta $detT para o destino."
      $TargetPort = $detT
    } else {
      Write-Host "[sync-db] ERRO: não foi possível conectar na porta de destino $TargetPort e nenhuma porta alternativa foi detectada." -ForegroundColor Red
      exit 1
    }
  }

  $env:PGPASSWORD = $TargetPass
  & "$pgRestoreExe" --no-owner --no-privileges -h $TargetHost -p $TargetPort -U $TargetUser -d $TargetDb $dumpFile
  if ($LASTEXITCODE -ne 0) { throw "pg_restore falhou (exitcode $LASTEXITCODE)" }

  Write-Note "Restauração concluída com sucesso."
} catch {
  Write-Host "[sync-db] ERRO: $_" -ForegroundColor Red
  exit 1
} finally {
  Remove-Item -ErrorAction SilentlyContinue $dumpFile
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}


