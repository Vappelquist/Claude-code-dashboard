@echo off
cd /d "%~dp0"
if not exist "node_modules\electron" call npm install
start "" npx electron .
