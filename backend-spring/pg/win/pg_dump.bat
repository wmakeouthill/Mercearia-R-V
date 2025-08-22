@echo off
rem Create output file if -f provided or if any arg looks like a dump filename
set OUT=
set FOUND=
for %%A in (%*) do (
  if /I "%%~xA"==".dump" (
    set OUT=%%~A
    set FOUND=1
  )
)
if "%FOUND%"=="" (
  rem try to parse -f
  :loop
  if "%1"=="" goto after
  if "%1"=="-f" (
    shift
    set OUT=%1
    goto after
  )
  shift
  goto loop
)
:after
if defined OUT (
  for %%F in ("%OUT%") do (
    if not exist "%%~dpF" mkdir "%%~dpF"
  )
  type nul > "%OUT%"
)
echo pg_dump (stub) 1.0
exit /b 0

