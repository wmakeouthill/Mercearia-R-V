; Set default installation directory to root of C: for writable install location
InstallDir "C:\\${PRODUCT_NAME}"

; Ensure SetShellVarContext is executed during init. Define as a macro so electron-builder
; can insert it into its generated .onInit without introducing duplicate function names.
!macro customInit
  SetShellVarContext all
!macroend

!macro customInstall
  ; Copiar dados do Postgres empacotado para o diretório de instalação (INSTDIR) durante a instalação
  DetailPrint "Copying embedded Postgres data to installation directory..."
  CreateDirectory "$INSTDIR\\backend-spring\\data\\pg"
  nsExec::ExecToLog 'xcopy "$INSTDIR\\resources\\backend-spring\\data\\pg" "$INSTDIR\\backend-spring\\data\\pg" /E /I /Y'
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


