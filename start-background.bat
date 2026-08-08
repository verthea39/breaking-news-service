@echo off
cd /d "%~dp0"
if not exist "logs" mkdir logs
echo Starting Breaking News Service in the background...
powershell -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -Command "Start-Process node -ArgumentList 'index.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
echo Service started successfully in the background!
echo Output logs will be written to logs\service.log
ping -n 3 127.0.0.1 >nul

