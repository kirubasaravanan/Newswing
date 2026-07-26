@echo off
REM =====================================================================
REM  Newswing - daily launcher (Windows)
REM  Double-click this file each day to start the app.
REM  Opens one window (Web) and your browser.
REM  Close that window to stop the app.
REM  Port 3004 - deliberately different from ODSS (3000), Fxproc (3001),
REM  and Forex (3005) so all four can run at the same time with no clash.
REM =====================================================================
setlocal

set "REPO=%~dp0"

echo ============================================================
echo   Newswing
echo   Repo: %REPO%
echo ============================================================
echo.
echo Starting Web (3004)...
echo.

start "Newswing Web (3004)" /D "%REPO%" cmd /k npx next dev -p 3004

echo Waiting ~10s for the server to boot...
timeout /t 10 /nobreak >nul
start "" "http://localhost:3004"

echo.
echo Newswing is running. Dashboard: http://localhost:3004
echo To stop: close the "Newswing Web" window.
echo.
pause
endlocal
