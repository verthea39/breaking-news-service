@echo off
cd /d "%~dp0"
echo ========================================================
echo   Starting Global Internet Tunnel for Breaking News Service
echo ========================================================
echo.
echo Make sure the service is running first (http://localhost:3000).
echo Creating public URL via localtunnel...
echo.
npx localtunnel --port 3000
pause
