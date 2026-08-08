@echo off
cd /d "%~dp0"
echo Stopping Breaking News Service background process on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    echo Terminating PID %%a listening on port 3000...
    taskkill /F /PID %%a /T 2>nul
)
echo Background process on port 3000 stopped successfully.
timeout /t 3

