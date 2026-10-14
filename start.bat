@echo off
rem Inicia o painel de cameras. Opcional: set PORT=7391 / set HOST=0.0.0.0 antes de executar.
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
if exist "runtime\ffmpeg.exe" if not defined FFMPEG_PATH set "FFMPEG_PATH=%~dp0runtime\ffmpeg.exe"
"%NODE_EXE%" src\index.js
if errorlevel 1 pause
exit /b

:no_node
echo Node.js nao encontrado. Instale o Node 20.3 ou superior: https://nodejs.org
echo (ou use o pacote de release que ja vem com o Node embutido)
pause
exit /b 1
