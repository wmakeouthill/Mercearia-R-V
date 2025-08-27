$ErrorActionPreference = 'Stop'
$body = @{ username = 'Wesley'; password = 'Angel1202@' } | ConvertTo-Json
$r = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/auth/login' -Method Post -Body $body -ContentType 'application/json'
$token = $r.token
Write-Output ('TOKEN:' + $token)

# Fetch all items
$tudo = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/caixa/movimentacoes?all=true' -Headers @{ Authorization = "Bearer $token" }
$mes = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/caixa/movimentacoes/mes?ano=2025&mes=8&all=true' -Headers @{ Authorization = "Bearer $token" }

# Save raw payloads
$tudo | ConvertTo-Json -Depth 6 | Out-File -Encoding UTF8 all_items_tudo.json
$mes | ConvertTo-Json -Depth 6 | Out-File -Encoding UTF8 all_items_mes.json

# Build dedupe key
function key($m){ if($m.tipo -eq 'venda'){ return ("$($m.id)|$($m.metodo_pagamento)|$($m.pagamento_valor)") } else { return ("$($m.id)") } }

$mapTudo = @{}
foreach($i in $tudo.items){ $k = key $i; if(-not $mapTudo.ContainsKey($k)){ $mapTudo[$k] = $i } }
$mapMes = @{}
foreach($i in $mes.items){ $k = key $i; if(-not $mapMes.ContainsKey($k)){ $mapMes[$k] = $i } }

$inTudoNotMes = $mapTudo.Keys | Where-Object { -not $mapMes.ContainsKey($_) } | ForEach-Object { $mapTudo[$_] }

# Save diff
$inTudoNotMes | ConvertTo-Json -Depth 6 | Out-File -Encoding UTF8 diff_tudo_not_mes.json

Write-Output ('IN_TUDO_NOT_MES_COUNT:' + ($inTudoNotMes.Count))
Write-Output ('Saved files: all_items_tudo.json, all_items_mes.json, diff_tudo_not_mes.json')
