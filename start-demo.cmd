@echo off
chcp 65001 >nul 2>&1
REM Prism local demo launcher.
REM Double-click this file to build (if needed) and start the local server.
REM
REM Two hard rules for this file:
REM   1. Keep it pure ASCII. cmd.exe parses .cmd as GBK, so UTF-8 Chinese
REM      here would be garbled and break the whole script. (The chcp 65001
REM      above only exists so node's own UTF-8 output displays correctly.)
REM   2. Keep CRLF line endings. cmd.exe mis-parses block statements
REM      and labels in LF-only files. Run "npm run fix:cmd-eol" after editing.

cd /d "%~dp0"

echo.
echo   Prism local demo
echo.

if exist "packages\core\dist\index.global.js" goto serve

echo   dist not found, building first...
echo.
call npm run build
if errorlevel 1 goto buildfailed

:serve
echo   Starting server on http://localhost:5173
echo.
echo   Demo site  http://localhost:5173/apps/demo-site/
echo   Dashboard  http://localhost:5173/apps/dashboard/dist/
echo.
echo   Keep this window open. Closing it stops the server.
echo   Press Ctrl+C to stop.
echo.

start "" http://localhost:5173/apps/demo-site/

node scripts\serve.mjs
goto end

:buildfailed
echo.
echo   Build failed. Scroll up to see the error above.
pause
exit /b 1

:end
pause
