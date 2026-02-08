@echo off
set "DOCS_DIR=%~dp0local_link_docs"
echo Starting LocalLink Documentation...
cd /d "%DOCS_DIR%"

:: Start the dev server in a new window
start "LocalLink Docs Server" cmd /c "npm run dev"

:: Wait a few seconds for the server to initialize
echo Waiting for server to start...
timeout /t 5 /nobreak > nul

:: Open the browser
start http://localhost:5173/

echo Done! Documentation server is running in a separate window.
pause
