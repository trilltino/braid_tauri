@echo off
setlocal enabledelayedexpansion

set "CARGO_TARGET_DIR=C:\braid_target"
set "RUST_LOG=info,braid_core=debug,xf_tauri=debug,server=debug"

echo ========================================
echo   Braid Full Local Test (2 Clients)
echo ========================================
echo.

REM Create directories for two separate clients
if not exist client_a mkdir client_a
if not exist client_b mkdir client_b

REM Build server if not already built
if not exist "%CARGO_TARGET_DIR%\release\server.exe" (
    echo [BUILD] Building Chat Server...
    cargo build --release --package server
)

REM Kill any existing instances
taskkill /F /IM "server.exe" /T 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3002 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul

REM Start Chat Servers for both clients
echo [1/4] Starting Chat Server A on port 3001...
start "CHAT SERVER A" cmd /c "set RUST_LOG=%RUST_LOG%& set BRAID_ROOT=%~dp0client_a& set SERVER_PORT=3001& cd /d "%~dp0" & echo === CHAT SERVER A (port 3001) === & "%CARGO_TARGET_DIR%\release\server.exe" || pause"

timeout /t 2 /nobreak >nul

echo [2/4] Starting Chat Server B on port 3002...
start "CHAT SERVER B" cmd /c "set RUST_LOG=%RUST_LOG%& set BRAID_ROOT=%~dp0client_b& set SERVER_PORT=3002& cd /d "%~dp0" & echo === CHAT SERVER B (port 3002) === & "%CARGO_TARGET_DIR%\release\server.exe" || pause"

timeout /t 2 /nobreak >nul

REM Start Client A (User A)
echo [3/4] Starting Tauri Client A on port 8081...
start "Client A UI" cmd /c "cd /d "%~dp0xf_tauri" && set BRAID_ROOT=%~dp0client_a&& set CHAT_SERVER_URL=http://localhost:3001&& npm run tauri dev -- --port 8081"

REM Wait a bit for build/start
timeout /t 5 /nobreak >nul

REM Start Client B (User B)
echo [4/4] Starting Tauri Client B on port 8082...
start "Client B UI" cmd /c "cd /d "%~dp0xf_tauri" && set BRAID_ROOT=%~dp0client_b&& set CHAT_SERVER_URL=http://localhost:3002&& npm run tauri dev -- --port 8082"

echo.
echo ========================================
echo   Two Full Braid Stacks Started!
echo ========================================
echo.
echo CLIENT A:
echo   Server:  http://localhost:3001
echo   UI Port: 8081
echo   Data:    %~dp0client_a
echo.
echo CLIENT B:
echo   Server:  http://localhost:3002
echo   UI Port: 8082
echo   Data:    %~dp0client_b
echo.
echo Use the UI to add each other as friends using their emails.
echo ========================================
pause
