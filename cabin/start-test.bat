@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" http://localhost:3013/cabin/
node server\test-server.js
pause
