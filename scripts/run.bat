@echo off
setlocal enabledelayedexpansion

:: ========================================
:: LocalLink Full Stack Launcher
:: ========================================
:: Starts: Server + Web Editor (local_link_docs) + Tauri UI + Daemon
::
:: Usage: run.bat [options]
::   Options:
::     --no-tauri    Skip Tauri UI, run web only
::     --no-web      Skip web editor, run Tauri only
::     --daemon      Include braidfs-daemon
:: ========================================

:: Configuration
set "BRAID_ROOT=%~dp0..\braid_data"
set "CARGO_TARGET_DIR=%~dp0..\target"
set "RUST_LOG=info,braid_core=info,local_link=info,server=info"
set "SERVER_PORT=3001"
set "WEB_PORT=5173"
set "TAURI_PORT=1420"
set "DAEMON_PORT=45678"

:: Parse arguments
set "RUN_TAURI=1"
set "RUN_WEB=1"
set "RUN_DAEMON=0"

:parse_args
if "%~1"=="" goto :done_args
if "%~1"=="--no-tauri" set "RUN_TAURI=0"
if "%~1"=="--no-web" set "RUN_WEB=0"
if "%~1"=="--daemon" set "RUN_DAEMON=1"
shift
goto :parse_args
:done_args

echo ========================================
echo   LocalLink Full Stack Launcher
echo ========================================
echo.

:: Ensure directories exist
if not exist "%BRAID_ROOT%" mkdir "%BRAID_ROOT%"
if not exist "%BRAID_ROOT%\braid.org" mkdir "%BRAID_ROOT%\braid.org"
if not exist "%BRAID_ROOT%\local.org" mkdir "%BRAID_ROOT%\local.org"

:: ========================================
:: 1. Cleanup existing processes
:: ========================================
echo [CLEANUP] Stopping existing processes...
taskkill /F /IM "local_link_server.exe" /T 2>nul
taskkill /F /IM "braidfs-daemon.exe" /T 2>nul
taskkill /F /IM "node.exe" /T 2>nul

:: Kill processes by port
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%SERVER_PORT% ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%WEB_PORT% ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%DAEMON_PORT% ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul

timeout /t 2 /nobreak >nul

:: ========================================
:: 2. Build components
:: ========================================
echo.
echo [BUILD] Building components...

:: Build Server
echo   - Building server...
cargo build --release --package local_link_server
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Server build failed!
    pause
    exit /b 1
)

:: Build Daemon if requested
if "%RUN_DAEMON%"=="1" (
    echo   - Building daemon...
    cargo build --release --package braidfs-daemon
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Daemon build failed!
        pause
        exit /b 1
    )
)

:: Build Tauri if requested
if "%RUN_TAURI%"=="1" (
    echo   - Checking Tauri dependencies...
    cd /d "%~dp0..\local_link"
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Tauri npm install failed!
        pause
        exit /b 1
    )
    cd /d "%~dp0"
)

:: Install web editor dependencies (local_link_docs)
if "%RUN_WEB%"=="1" (
    echo   - Checking web editor dependencies (local_link_docs)...
    cd /d "%~dp0..\local_link_docs"
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Web editor npm install failed!
        pause
        exit /b 1
    )
    cd /d "%~dp0"
)

:: ========================================
:: 3. Start Services
:: ========================================
echo.
echo [STARTUP] Starting services...

:: Start Server
echo   [1] Starting server on port %SERVER_PORT%...
start "LOCAL LINK SERVER" cmd /c "set RUST_LOG=%RUST_LOG%& set BRAID_ROOT=%BRAID_ROOT%& cd /d "%~dp0.." & echo === SERVER (port %SERVER_PORT%) === & "%CARGO_TARGET_DIR%\release\local_link_server.exe" || pause"

timeout /t 3 /nobreak >nul

:: Verify server is up
echo   - Checking server health...
:check_server
curl -s http://localhost:%SERVER_PORT%/health >nul 2>&1
if %ERRORLEVEL% neq 0 (
    timeout /t 1 /nobreak >nul
    goto :check_server
)
echo     ^✓ Server ready

:: Start Web Editor (local_link_docs)
if "%RUN_WEB%"=="1" (
    echo   [2] Starting web editor (local_link_docs) on port %WEB_PORT%...
    start "WEB EDITOR (local_link_docs)" cmd /c "cd /d "%~dp0..\local_link_docs" && echo === WEB EDITOR (port %WEB_PORT%) === && npm run dev -- --port %WEB_PORT% || pause"
    timeout /t 3 /nobreak >nul
    echo     ^✓ Web editor ready
)

:: Start Tauri
if "%RUN_TAURI%"=="1" (
    echo   [3] Starting Tauri UI...
    start "TAURI UI" cmd /c "cd /d "%~dp0..\local_link" && set BRAID_ROOT=%BRAID_ROOT%&& set CHAT_SERVER_URL=http://localhost:%SERVER_PORT%&& echo === TAURI UI === && npm run tauri dev || pause"
    timeout /t 3 /nobreak >nul
    echo     ^✓ Tauri starting (may take 30s for first build)
)

:: Start Daemon
if "%RUN_DAEMON%"=="1" (
    echo   [4] Starting braidfs-daemon...
    start "BRAIDFS DAEMON" cmd /c "cd /d "%~dp0.." && echo === DAEMON (port %DAEMON_PORT%) === && "%CARGO_TARGET_DIR%\release\braidfs-daemon.exe" || pause"
    timeout /t 2 /nobreak >nul
    echo     ^✓ Daemon starting
)

:: ========================================
:: 4. Display Info
:: ========================================
echo.
echo ========================================
echo   LocalLink Stack Started!
echo ========================================
echo.
echo [SERVICES]
echo   Server:      http://localhost:%SERVER_PORT%/health
echo.

if "%RUN_WEB%"=="1" (
echo   Web Editor:  http://localhost:%WEB_PORT%/pages
echo                ^(local_link_docs version with Quill editor^)
echo.
)

if "%RUN_TAURI%"=="1" (
echo   Tauri UI:    http://localhost:%TAURI_PORT%/
echo                ^(Main application^)
echo.
)

if "%RUN_DAEMON%"=="1" (
echo   Daemon:      http://localhost:%DAEMON_PORT%/
echo.
)

echo [DATA DIRECTORY]
echo   %BRAID_ROOT%
echo.

echo [QUICK TEST]
echo   1. Open Web Editor: http://localhost:%WEB_PORT%/pages
echo   2. Enter URL: http://localhost:%SERVER_PORT%/test.md
echo   3. Click Connect
echo   4. Open second browser tab with same URL
echo   5. Edit in one - see updates in other!
echo.

echo [COMMANDS]
echo   Close all windows or press Ctrl+C in each
echo.
echo Press any key to stop all services...
pause >nul

:: ========================================
:: 5. Cleanup on exit
:: ========================================
echo.
echo [SHUTDOWN] Stopping all services...
taskkill /F /IM "local_link_server.exe" /T 2>nul
taskkill /F /IM "braidfs-daemon.exe" /T 2>nul
taskkill /F /IM "node.exe" /T 2>nul

echo   All services stopped.
timeout /t 2 /nobreak >nul
