@echo off
chcp 65001 >nul
title ORMA WhatsApp Bot - leave this window open
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto install_node

if exist "node_modules\@whiskeysockets\baileys" goto run
echo.
echo  First run: downloading what the bot needs. This happens one time only...
echo.
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 goto install_failed

:run
echo.
echo  Starting the ORMA bot... the control page will open in your browser.
echo  KEEP THIS WINDOW OPEN. If you close it, the bot stops replying.
echo.
node src\index.js
echo.
echo  The bot stopped. Restarting in 5 seconds - close this window to stop it for good.
timeout /t 5 >nul
goto run

:install_node
echo.
echo  Node.js is not installed yet. Trying to install it automatically...
echo.
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto manual_node
echo.
echo  ============================================================
echo   Node.js was installed.
echo   Close this window, then double-click START-BOT again.
echo  ============================================================
pause
exit /b

:manual_node
start "" https://nodejs.org/
echo.
echo  ============================================================
echo   Could not install Node.js automatically.
echo   A page opened in your browser: download the LTS version,
echo   install it with Next, Next, Finish,
echo   then double-click START-BOT again.
echo  ============================================================
pause
exit /b

:install_failed
echo.
echo  ============================================================
echo   Download failed. Check your internet connection,
echo   then double-click START-BOT again.
echo  ============================================================
pause
exit /b
