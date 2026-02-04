@echo off
echo Starting Braid Full Local Test...

REM Create directories for two separate clients
mkdir client_a
mkdir client_b

REM Start Client A (User A)
start "Client A" cmd /c "cd /d "%~dp0xf_tauri" && set BRAID_ROOT=%~dp0client_a&& set SERVER_PORT=3001&& set TAURI_PORT=8081&& npm run tauri dev"

REM Wait a bit for build/start
timeout /t 5

REM Start Client B (User B)
start "Client B" cmd /c "cd /d "%~dp0xf_tauri" && set BRAID_ROOT=%~dp0client_b&& set SERVER_PORT=3002&& set TAURI_PORT=8082&& npm run tauri dev"

echo Two clients started. 
echo Client A Data: %~dp0client_a
echo Client B Data: %~dp0client_b
echo.
echo Directory structure will be created automatically:
echo   - local/    (SQLite DB, config)
echo   - peers/    (P2P chat files)
echo   - ai/       (AI chat files)
echo   - braid.org/ (Wiki pages)
echo.
echo Use the UI to add each other as friends using their emails.
pause
