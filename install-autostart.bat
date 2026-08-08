@echo off
cd /d "%~dp0"
echo ===================================================
echo   Installing Breaking News Service Autostart Task
echo ===================================================
echo.

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_FOLDER%\BreakingNewsService.lnk"
set "TARGET_VBS=%~dp0start-background.vbs"

echo Creating autostart shortcut in:
echo %SHORTCUT_PATH%
echo Target script: %TARGET_VBS%
echo.

powershell -ExecutionPolicy Bypass -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%TARGET_VBS%'; $s.WorkingDirectory = '%~dp0'; $s.WindowStyle = 7; $s.Save()"

if exist "%SHORTCUT_PATH%" (
    echo ✅ Autostart installed successfully!
    echo Breaking News Service will now launch automatically in the background whenever Windows starts up.
) else (
    echo ❌ Failed to create startup shortcut.
)

echo.
pause
