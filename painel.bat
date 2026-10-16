@echo off
setlocal
rem Menu do painel (duplo clique): iniciar em segundo plano, parar, abrir no navegador,
rem ligar/desligar o inicio automatico. Tambem aceita comandos: painel.bat start | stop | status
rem (use este arquivo no terminal: o nome "start.bat" colide com o comando interno "start" do cmd)
if "%~1"=="" goto menu
call "%~dp0start.bat" %*
exit /b %errorlevel%

:menu
call "%~dp0start.bat" menu
exit /b %errorlevel%
