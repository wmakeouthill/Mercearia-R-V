; NSIS Script Otimizado para instalação rápida

; Set default installation directory to root of C: for writable install location
InstallDir "C:\\${PRODUCT_NAME}"

; Ensure SetShellVarContext is executed during init. Define as a macro so electron-builder
; can insert it into its generated .onInit without introducing duplicate function names.
!macro customInit
  SetShellVarContext all
!macroend

!macro customInstall
  ; Configurações para instalação rápida
  SetDetailsPrint listonly
  
  ; Copiar dados do Postgres empacotado para o diretório de instalação (INSTDIR) durante a instalação
  DetailPrint "Copying embedded Postgres data to installation directory..."
  CreateDirectory "$INSTDIR\\backend-spring\\data"
  ; Path corrigido conforme extraResources do package.json
  IfFileExists "$INSTDIR\\resources\\data\\pg" 0 +3
    nsExec::ExecToLog 'xcopy "$INSTDIR\\resources\\data\\pg" "$INSTDIR\\backend-spring\\data\\pg" /E /I /Y /Q'
    DetailPrint "Postgres data copied successfully"
  DetailPrint "Install customization finished"
!macroend

!macro customUnInstall
  ; Remover entrada do hosts adicionada pelo app (método simplificado)
  DetailPrint "Cleaning hosts entry for merceariarv.app..."
  ; Usar findstr simples em vez de PowerShell complexo para evitar travamentos
  nsExec::ExecToLog 'cmd /c "findstr /v /i "merceariarv.app" "%windir%\\System32\\drivers\\etc\\hosts" > "%temp%\\hosts_temp" 2>nul && move /y "%temp%\\hosts_temp" "%windir%\\System32\\drivers\\etc\\hosts" 2>nul || echo Hosts cleanup skipped"'
  Pop $0
  DetailPrint "Hosts cleanup finished"
!macroend


