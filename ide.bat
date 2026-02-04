@echo off
setlocal

:: Configuration
set "BRAID_ROOT=%~dp0braid_sync"
set "CARGO_TARGET_DIR=C:\braid_target"
set "RUSTFLAGS=-C target-cpu=native"

echo ========================================
echo       BraidFS IDE Helper (Daemon)
echo ========================================

:: 1. Cleanup existing daemon
echo [1/2] Cleaning up existing daemon...
taskkill /F /IM "braidfs-daemon.exe" /T 2>nul
timeout /t 1 /nobreak >nul

:: 2. Build Daemon
echo [2/2] Ensuring Daemon is built...
cargo build --release --package braidfs-daemon

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

echo.
echo Launching BraidFS Daemon...
echo.
echo [STATUS] Running! You can now edit files in:
echo          %BRAID_ROOT%
echo.
echo [TIP] Keep this window open. It will automatically push your IDE saves to the Braid network.
echo.

:: Run Daemon in current window so logs are visible
set RUST_LOG=info,braid_core=info
"%CARGO_TARGET_DIR%\release\braidfs-daemon.exe"

pause
