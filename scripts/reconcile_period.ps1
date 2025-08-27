param(
  [string]$inicio = '2025-08-01',
  [string]$fim = '2025-08-31'
)
$ErrorActionPreference = 'Stop'
$body = @{ username = 'Wesley'; password = 'Angel1202@' } | ConvertTo-Json
$r = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/auth/login' -Method Post -Body $body -ContentType 'application/json'
$token = $r.token
Write-Output ('TOKEN:' + $token)

$summaryUrl = "http://127.0.0.1:3000/api/caixa/movimentacoes/summary?periodo_inicio=$inicio&periodo_fim=$fim"
$caixaSummary = Invoke-RestMethod -Uri $summaryUrl -Headers @{ Authorization = "Bearer $token" }

$vendasRelUrl = "http://127.0.0.1:3000/api/vendas/relatorios/mes"
$vendasRel = Invoke-RestMethod -Uri $vendasRelUrl -Headers @{ Authorization = "Bearer $token" }

# fetch individual sales to sum total_final
try {
  $salesUrl = "http://127.0.0.1:3000/api/vendas/search?from=$inicio&to=$fim&page=0&size=10000"
  $sales = Invoke-RestMethod -Uri $salesUrl -Headers @{ Authorization = "Bearer $token" }
  $salesItems = $sales.items
  $sumSalesTotalFinal = ($salesItems | Measure-Object -Property total_final -Sum).Sum
  Write-Output "SUM_SALES_TOTAL_FINAL: $sumSalesTotalFinal"
} catch {
  Write-Output "WARN: sales search failed: $($_.Exception.Message) - skipping sales aggregation"
  $salesItems = @()
  $sumSalesTotalFinal = 0
}

$movsUrl = "http://127.0.0.1:3000/api/caixa/movimentacoes?periodo_inicio=$inicio&periodo_fim=$fim&all=true"
$movs = Invoke-RestMethod -Uri $movsUrl -Headers @{ Authorization = "Bearer $token" }

# compute sums from movs
$items = $movs.items
$sumVendasFromMovs = ($items | Where-Object { $_.tipo -eq 'venda' } | Measure-Object -Property valor -Sum).Sum
$sumEntradasFromMovs = ($items | Where-Object { $_.tipo -eq 'entrada' } | Measure-Object -Property valor -Sum).Sum
$sumRetiradasFromMovs = ($items | Where-Object { $_.tipo -eq 'retirada' } | Measure-Object -Property valor -Sum).Sum

$report = [ordered]@{
  periodo = "$inicio to $fim";
  caixaSummary = $caixaSummary;
  vendasRelatorio = $vendasRel;
  salesSummary = @{ total_sales = ($salesItems | Measure-Object).Count; sum_total_final = $sumSalesTotalFinal };
  movsCounts = @{ total = $movs.total; items = ($items | Measure-Object).Count };
  sums = @{ movs_sum_vendas = $sumVendasFromMovs; movs_sum_entradas = $sumEntradasFromMovs; movs_sum_retiradas = $sumRetiradasFromMovs };
}

$report | ConvertTo-Json -Depth 6 | Out-File -Encoding UTF8 reconciliation.json
Write-Output ('Saved reconciliation.json')
Write-Output "CAIXA_SUMMARY_SUM_VENDAS: $($caixaSummary.sum_vendas)"
Write-Output "MOVS_COMPUTED_SUM_VENDAS: $sumVendasFromMovs"
if ($vendasRel.receita_total -ne $null) { Write-Output "RELATORIO_VENDAS_RECEITA_TOTAL: $($vendasRel.receita_total)" } else { Write-Output "RELATORIO_VENDAS_OBJ: $($vendasRel | ConvertTo-Json -Depth 2)" }

$diff1 = [math]::Round(($vendasRel.receita_total - $caixaSummary.sum_vendas),2)
$diff2 = [math]::Round(($vendasRel.receita_total - $sumVendasFromMovs),2)
Write-Output "DIFF relatorio_vs_caixaSummary: $diff1"
Write-Output "DIFF relatorio_vs_movsComputed: $diff2"

# Save top 20 movs not matching by sale id: group movs by id and sum payment lines
$grouped = @{}
foreach ($it in $items) {
  $key = $it.id
  if (-not $grouped.ContainsKey($key)) { $grouped[$key] = @{ id = $key; total = 0.0; methods = @{} } }
  $grouped[$key].total += ($it.valor -as [double])
  $m = $it.metodo_pagamento -as [string]
  if (-not $m) { $m = '<none>' }
  if (-not $grouped[$key].methods.ContainsKey($m)) { $grouped[$key].methods[$m] = 0 }
  $grouped[$key].methods[$m] += ($it.valor -as [double])
}
$groups = $grouped.Values | Sort-Object -Property total -Descending
$groups | Select-Object -First 20 | ConvertTo-Json -Depth 6 | Out-File -Encoding UTF8 reconciliation_groups_top20.json
Write-Output 'Saved reconciliation_groups_top20.json'
