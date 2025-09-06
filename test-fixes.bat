@echo off
echo 🔄 Testando correções para redirecionamentos e localStorage...

REM Limpar processos anteriores
echo 🧹 Limpando processos anteriores...
cd /d "%~dp0"
call npm run cleanup:all

REM Aguardar um pouco
timeout /t 3 /nobreak > nul

REM Compilar aplicação
echo 🔨 Compilando aplicação...
call npm run build:all

if %ERRORLEVEL% EQU 0 (
    echo ✅ Compilação bem-sucedida!
    echo.
    echo 🚀 Iniciando aplicação em modo de produção...
    echo    - Splash será mostrado primeiro
    echo    - Aguardará backend estar pronto
    echo    - Frontend servido pelo backend
    echo    - localStorage com debugging habilitado
    echo    - webSecurity temporariamente desabilitado para debug
    echo.
    
    REM Executar aplicação
    echo 📦 Executando dist:win...
    call npm run dist:win
) else (
    echo ❌ Erro na compilação!
    pause
    exit /b 1
)
