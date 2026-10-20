@echo off
setlocal
cd /d "%~dp0"
title Iron Lab
echo.
echo  ==============================
echo    IRON LAB - starting server
echo  ==============================
echo.

where node >nul 2>nul
if errorlevel 1 goto nonode

node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]==22&&v[1]>=5)?0:1)"
if errorlevel 1 goto oldnode

if not exist node_modules goto install
goto run

:install
echo First run: installing dependencies, this takes a minute...
call npm install --omit=dev
if errorlevel 1 goto npmfail

:run
if not defined PORT set PORT=3000
if not exist .env echo No .env file found - running in development mode with demo data. See .env.example for production.
echo.
echo  Site:   http://localhost:%PORT%
echo  Admin:  http://localhost:%PORT%/dashboard/admin.html
echo  Demo admin login: admin@ironlab.gym / Admin123!   (development only)
echo.
echo  Press Ctrl+C to stop the server.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:%PORT%"
node server/index.js
echo.
echo Server stopped.
pause
exit /b 0

:nonode
echo Node.js is not installed. Download version 22.5 or newer from https://nodejs.org and run this again.
pause
exit /b 1

:oldnode
echo Your Node.js is too old. Iron Lab needs version 22.5 or newer. Get it from https://nodejs.org
node --version
pause
exit /b 1

:npmfail
echo Dependency install failed. Check your internet connection and try again.
pause
exit /b 1
