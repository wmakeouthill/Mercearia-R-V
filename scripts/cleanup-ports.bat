@echo off
echo Limpando processos e portas...

REM Finalizar processos Java
taskkill /F /IM java.exe /T 2>nul >nul

REM Finalizar processos Node
taskkill /F /IM node.exe /T 2>nul >nul

REM Finalizar processos PostgreSQL
taskkill /F /IM postgres.exe /T 2>nul >nul

REM Liberar porta 3000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do taskkill /F /PID %%a 2>nul >nul

REM Liberar porta 4200
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :4200') do taskkill /F /PID %%a 2>nul >nul

REM Aguardar um pouco
timeout /t 2 >nul

REM Remover arquivos de lock do PostgreSQL
del /Q "backend-spring\data\pg\epg-lock" 2>nul >nul
del /Q "backend-spring\data\pg\postmaster.pid" 2>nul >nul

echo Limpeza concluida!
