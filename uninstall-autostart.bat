@echo off
cd /d "%~dp0"
echo Removing Breaking News Service Autostart Task...

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_FOLDER%\BreakingNewsService.lnk"

if exist "%SHORTCUT_PATH%" (
    del /f /q "%SHORTCUT_PATH%"
    echo ✅ Autostart shortcut removed successfully.
) else (
    echo Autostart shortcut was not found in Startup folder.
)

pause
