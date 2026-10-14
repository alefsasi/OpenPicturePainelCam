@echo off
rem Inicia o painel de cameras. Opcional: set PORT=7391 / set HOST=0.0.0.0 antes de executar.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node 20.3 ou superior: https://nodejs.org
  pause
  exit /b 1
)

node src\index.js
if errorlevel 1 pause
