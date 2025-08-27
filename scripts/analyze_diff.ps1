$ErrorActionPreference = 'Stop'
$path = "diff_tudo_not_mes.json"
if (-not (Test-Path $path)) { Write-Error "File not found: $path"; exit 1 }
$json = Get-Content $path -Raw | ConvertFrom-Json
$total = ($json | Measure-Object).Count
Write-Output "TOTAL_DIFF: $total"

# counts by metodo_pagamento
$byMetodo = @{}
foreach ($item in $json) {
    $met = $item.metodo_pagamento
    if (-not $met) { $met = '<none>' }
    if (-not $byMetodo.ContainsKey($met)) { $byMetodo[$met] = 0 }
    $byMetodo[$met] += 1
}
Write-Output "COUNTS_BY_METODO:";
$byMetodo.GetEnumerator() | Sort-Object -Property Value -Descending | ForEach-Object { Write-Output "  $($_.Key): $($_.Value)" }

# count with caixa_status_id
$withCaixa = ($json | Where-Object { $_.caixa_status_id -ne $null } | Measure-Object).Count
Write-Output "WITH_CAIXA_STATUS_ID: $withCaixa"

# counts by month
$byMonth = @{}
foreach ($item in $json) {
    try {
        $dt = [datetime]::Parse($item.data_movimento)
        $ym = $dt.ToString('yyyy-MM')
    } catch {
        $ym = '<invalid>'
    }
    if (-not $byMonth.ContainsKey($ym)) { $byMonth[$ym] = 0 }
    $byMonth[$ym] += 1
}
Write-Output "COUNTS_BY_MONTH:";
$byMonth.GetEnumerator() | Sort-Object -Property Name | ForEach-Object { Write-Output "  $($_.Key): $($_.Value)" }

# sample items
Write-Output "SAMPLE_ITEMS (first 30):"
$count = 0
foreach ($item in $json) {
    $count += 1
    $line = @{ id = $item.id; metodo = $item.metodo_pagamento; pagamento_valor = $item.pagamento_valor; caixa_status_id = $item.caixa_status_id; data_movimento = $item.data_movimento }
    $line | ConvertTo-Json -Compress
    if ($count -ge 30) { break }
}

# Save a compact summary to file
$summary = [ordered]@{
    total = $total;
    byMetodo = $byMetodo;
    withCaixaStatus = $withCaixa;
    byMonth = $byMonth;
}
$summary | ConvertTo-Json -Depth 4 | Out-File -Encoding UTF8 diff_summary.json
Write-Output "Saved summary to diff_summary.json"
