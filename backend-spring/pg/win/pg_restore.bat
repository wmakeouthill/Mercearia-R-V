@echo off
set OUT=
:loopR
if "%1"=="" goto afterR
if "%1"=="-d" (
  shift
  set DBNAME=%1
  goto afterR
)
shift
goto loopR
:afterR
echo pg_restore (stub) 1.0
exit /b 0

