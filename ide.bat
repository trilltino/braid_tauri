@echo off
setlocal

:: Configuration
set "BRAID_ROOT=%~dp0braid_sync"
set "CARGO_TARGET_DIR=C:\braid_target"
set "RUSTFLAGS=-C target-cpu=native"
set "RUST_LOG=info,braid_core=info,server=info"

echo ========================================
echo    BraidFS IDE Helper (Server + Daemon)
echo ========================================

:: 1. Cleanup existing processes
echo [1/4] Cleaning up existing processes...
taskkill /F /IM "braidfs-daemon.exe" /T 2>nul
taskkill /F /IM "server.exe" /T 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :45678 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
timeout /t 1 /nobreak >nul

:: 2. Build Server
echo [2/4] Ensuring Chat Server is built...
cargo build --release --package server

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Server build failed!
    pause
    exit /b 1
)

:: 3. Build Daemon
echo [3/4] Ensuring Daemon is built...
cargo build --release --package braidfs-daemon

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Daemon build failed!
    pause
    exit /b 1
)

:: 4. Start Chat Server in background
echo [4/4] Starting Chat Server on port 3001...
start "CHAT SERVER" cmd /c "set RUST_LOG=%RUST_LOG%& set BRAID_ROOT=%BRAID_ROOT%& cd /d "%~dp0" & echo === CHAT SERVER (port 3001) === & "%CARGO_TARGET_DIR%\release\server.exe" || pause"

timeout /t 2 /nobreak >nul

echo.
echo ========================================
echo    BraidFS IDE Helper - ALL RUNNING!
echo ========================================
echo.
echo [SERVICES]
echo   Chat Server: http://localhost:3001
echo   Daemon API:  http://localhost:45678
echo   HTTP 209:    http://127.0.0.1:45679/subscribe/...
echo.
echo [HOW TO USE]
echo.
echo 1. EDIT IN IDE:
echo    Open: %BRAID_ROOT%\braid.org\antimatter_rs
echo    Edit ^& Save (Ctrl+S)
echo    → Auto-pushes to braid.org (instant)
echo.
echo 2. EDIT ON WEBSITE:
echo    https://braid.org/antimatter_rs
echo    → Auto-pulls to IDE (every 3 seconds)
echo.
echo 3. BRAID MAIL FEED:
echo    Open Tauri UI → Feed will now work!
echo.
echo [NOTE] Keep this window open for daemon logs!
echo.

:: Run Daemon in current window so logs are visible
"%CARGO_TARGET_DIR%\release\braidfs-daemon.exe"

pause
