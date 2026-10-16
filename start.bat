@echo off
setlocal
rem Painel de cameras. Sem argumentos roda nesta janela (Ctrl+C para parar).
rem Comandos (use painel.bat no terminal): start, stop, status, open, autostart on/off, menu
rem Usa o Node embutido em runtime\node.exe (pacote de release) ou o Node instalado no PATH.
rem Para o modo tempo real, coloque o ffmpeg.exe em runtime\ (ou defina FFMPEG_PATH).
cd /d "%~dp0"

if exist "runtime\node.exe" goto bundled
where node >nul 2>nul
if errorlevel 1 goto no_node
set "NODE_EXE=node"
goto run

:bundled
set "NODE_EXE=runtime\node.exe"

:run
"%NODE_EXE%" src\cli.js %*
if errorlevel 1 pause
exit /b

:no_node
echo Node.js nao encontrado. Instale o Node 20.3 ou superior: https://nodejs.org
echo (ou use o pacote de release que ja vem com o Node embutido)
pause
exit /b 1
