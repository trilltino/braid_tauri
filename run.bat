@echo off
setlocal enabledelayedexpansion

:: =========================================================
::               Braid Service Dashboard
:: =========================================================

:: --- Configuration ---
set "BRAID_ROOT=%~dp0braid_sync"
set "CARGO_TARGET_DIR=C:\braid_target"
set "RUSTFLAGS=-C target-cpu=native"
set "RUST_LOG=info,braid_core=debug,xf_tauri=debug,braid_tauri_chat_server=debug"

:menu
cls
echo =========================================================
echo               Braid Service Dashboard
echo =========================================================
echo.

:: Status Checks
set "UI_STATUS=[  STOPPED  ]"
tasklist /FI "IMAGENAME eq xf_tauri.exe" 2>nul | findstr /I "xf_tauri.exe" >nul && set "UI_STATUS=[  RUNNING  ]"

set "CHAT_SERVER_STATUS=[  STOPPED  ]"
tasklist /FI "IMAGENAME eq braid_tauri_chat_server.exe" 2>nul | findstr /I "braid_tauri_chat_server.exe" >nul && set "CHAT_SERVER_STATUS=[  RUNNING  ]"

set "DAEMON_STATUS=[  STOPPED  ]"
tasklist /FI "IMAGENAME eq braidfs-daemon.exe" 2>nul | findstr /I "braidfs-daemon.exe" >nul && set "DAEMON_STATUS=[  RUNNING  ]"

set "NFS_STATUS=[  STOPPED  ]"
tasklist /FI "IMAGENAME eq braidfs-nfs.exe" 2>nul | findstr /I "braidfs-nfs.exe" >nul && set "NFS_STATUS=[  STOPPED  ]"

echo %UI_STATUS% [2] Relaunch Tauri UI
echo %CHAT_SERVER_STATUS% [3] Relaunch Chat Server  (NEW: Auth + Chat + AI)
echo %DAEMON_STATUS% [4] Relaunch BraidFS Daemon
echo %NFS_STATUS% [5] Relaunch NFS Monitor
echo.
if "%UI_STATUS%"=="[  STOPPED  ]" echo [1] Start All Services
echo [6] Show Detailed Status
echo [0] Exit
echo.
echo =========================================================
set /p opt="Selection: "

if "%opt%"=="1" goto start_all
if "%opt%"=="2" goto relaunch_tauri
if "%opt%"=="3" goto relaunch_chat_server
if "%opt%"=="4" goto relaunch_daemon
if "%opt%"=="5" goto relaunch_nfs
if "%opt%"=="6" goto status
if "%opt%"=="0" exit /b 0
goto menu

:start_all
echo [INFO] Starting all services...
call :cleanup_all
call :ensure_storage
call :build_chat_server
call :build_daemon
call :build_nfs
call :launch_chat_server
timeout /t 2 >nul
call :launch_daemon
call :launch_nfs
call :launch_tauri
timeout /t 3 >nul
goto menu

:relaunch_tauri
echo [INFO] Relaunching Tauri UI...
taskkill /F /IM "xf_tauri.exe" /T 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :1420 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
echo [BUILD] Rebuilding Tauri (ensuring latest code)...
cd /d "%~dp0xf_tauri"
cargo build --no-default-features
cd /d "%~dp0"
call :launch_tauri
timeout /t 2 >nul
goto menu

:relaunch_chat_server
echo [INFO] Relaunching Chat Server...
taskkill /F /IM "braid_tauri_chat_server.exe" /T 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
call :build_chat_server
call :launch_chat_server
timeout /t 2 >nul
goto menu

:relaunch_daemon
echo [INFO] Relaunching BraidFS Daemon...
taskkill /F /IM "braidfs-daemon.exe" /T 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :45678 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
call :build_daemon
call :launch_daemon
timeout /t 2 >nul
goto menu

:relaunch_nfs
echo [INFO] Relaunching NFS Monitor...
taskkill /F /IM "braidfs-nfs.exe" /T 2>nul
call :build_nfs
call :launch_nfs
timeout /t 2 >nul
goto menu

:status
echo.
echo === Process Status ===
tasklist /FI "IMAGENAME eq xf_tauri.exe" | findstr /I "xf_tauri.exe" || echo [ ] Tauri UI is NOT running
tasklist /FI "IMAGENAME eq braid_tauri_chat_server.exe" | findstr /I "braid_tauri_chat_server.exe" || echo [ ] Chat Server is NOT running
tasklist /FI "IMAGENAME eq braidfs-daemon.exe" | findstr /I "braidfs-daemon.exe" || echo [ ] Daemon is NOT running
tasklist /FI "IMAGENAME eq braidfs-nfs.exe" | findstr /I "braidfs-nfs.exe" || echo [ ] NFS Monitor is NOT running
echo.
echo === Service URLs ===
echo Chat Server: http://localhost:3001
echo Daemon:      http://localhost:45678
echo Tauri UI:    http://localhost:1420
echo.
pause
goto menu

:: --- Shared Helpers ---

:cleanup_all
echo [CLEAN] Killing existing processes...
taskkill /F /IM "xf_tauri.exe" /T 2>nul
taskkill /F /IM "braid_tauri_chat_server.exe" /T 2>nul
taskkill /F /IM "braidfs-daemon.exe" /T 2>nul
taskkill /F /IM "braidfs-nfs.exe" /T 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :1420 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :45678 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
exit /b 0

:ensure_storage
if not exist "%BRAID_ROOT%" mkdir "%BRAID_ROOT%"
if not exist "%CARGO_TARGET_DIR%" mkdir "%CARGO_TARGET_DIR%"
echo [INFO] BRAID_ROOT set to: %BRAID_ROOT%
echo [INFO] New directory structure:
echo [INFO]   - braid_sync/chats/     (Chat rooms - JSON with CRDT)
echo [INFO]   - braid_sync/blobs/     (File attachments)
echo [INFO]   - braid_sync/ai/        (AI chat exports)
echo [INFO]   - braid_sync/users.sqlite (Auth database)
exit /b 0

:build_chat_server
echo [BUILD] Building Chat Server (Auth + Chat + AI)...
cargo build --release --package server
exit /b %ERRORLEVEL%

:build_daemon
echo [BUILD] Building Daemon...
cargo build --release --package braidfs-daemon
exit /b %ERRORLEVEL%

:build_nfs
echo [BUILD] Building NFS...
cargo build --release --package braidfs-nfs
exit /b %ERRORLEVEL%

:launch_chat_server
echo [LAUNCH] Starting Chat Server on port 3001...
start "CHAT SERVER" cmd /c "set RUST_LOG=%RUST_LOG%& set BRAID_ROOT=%BRAID_ROOT%& cd /d "%~dp0" & echo === CHAT SERVER (port 3001) === & "%CARGO_TARGET_DIR%\release\server.exe" || pause"
exit /b 0

:launch_daemon
echo [LAUNCH] Starting Daemon...
start "BRAIDFS DAEMON" cmd /c "set RUST_LOG=%RUST_LOG%& cd /d "%~dp0" & echo === BRAIDFS DAEMON === & "%CARGO_TARGET_DIR%\release\braidfs-daemon.exe" || pause"
exit /b 0

:launch_nfs
echo [LAUNCH] Starting NFS...
start "NFS MONITOR" cmd /c "set RUST_LOG=%RUST_LOG%& cd /d "%~dp0" & echo === NFS MONITOR === & "%CARGO_TARGET_DIR%\release\braidfs-nfs.exe" --mount-point "%BRAID_ROOT%" || pause"
exit /b 0

:launch_tauri
echo [LAUNCH] Starting Tauri...
start "TAURI UI (DEV)" cmd /c "set RUST_LOG=%RUST_LOG%& set CHAT_SERVER_URL=http://localhost:3001& set XF_SKIP_BACKEND=1 & cd /d "%~dp0xf_tauri" & cargo tauri dev || pause"
exit /b 0
