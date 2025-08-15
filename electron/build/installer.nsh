!macro customInstall
  ; Copiar dados do Postgres empacotado para o diretório do usuário durante a instalação
  DetailPrint "Copying embedded Postgres data to user's appdata..."
  CreateDirectory "$APPDATA\${PRODUCT_NAME}\data\pg"
  nsExec::ExecToLog 'xcopy "$INSTDIR\\resources\\backend-spring\\data\\pg" "$APPDATA\\${PRODUCT_NAME}\\data\\pg" /E /I /Y'
  Pop $0
  DetailPrint "Copy finished"
!macroend

!macro customUnInstall
  ; Remover entrada do hosts adicionada pelo app
  DetailPrint "Cleaning hosts entry for merceariarv.app..."
  ; Escape $ as $$ so NSIS doesn't try to expand PowerShell variables
  nsExec::ExecToLog 'powershell -Command "try { $$h = Join-Path $$env:windir \"System32\\drivers\\etc\\hosts\"; (Get-Content $$h) | Where-Object { $$_ -notmatch \"merceariarv.app\" } | Set-Content $$h } catch { exit 0 }"'
  Pop $0
  DetailPrint "Hosts cleanup finished"
!macroend


