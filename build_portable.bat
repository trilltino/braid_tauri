@echo off
setlocal
cd /d %~dp0

set "CARGO_TARGET_DIR=C:\braid_target"

echo ==============================================
echo   Braid Tauri - Portable Build Script
echo ==============================================
echo.

:: 1. Build the Chat Server first
echo [1/3] Building Chat Server...
cargo build --release --package server
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Server build failed!
    pause
    exit /b %ERRORLEVEL%
)

:: 2. Build BraidFS Daemon
echo [2/3] Building BraidFS Daemon...
cargo build --release --package braidfs-daemon
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Daemon build failed!
    pause
    exit /b %ERRORLEVEL%
)

:: 3. Navigate to xf_tauri and build UI
echo [3/3] Building Braid Tauri via Tauri CLI...
echo This will take a few minutes as it compiles Rust and bundles the app.
cd xf_tauri

:: Using npx to ensure tauri-cli is available without global install
:: This will automatically run 'npm run build' as defined in tauri.conf.json
call npx -y @tauri-apps/cli build

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Build failed during Tauri bundling.
    pause
    exit /b %ERRORLEVEL%
)

:: 4. Back to root
cd ..

:: 5. Create portable package directory
echo.
echo Creating portable package...
if not exist "portable" mkdir portable

:: Copy all binaries
if exist "%CARGO_TARGET_DIR%\release\xf_tauri.exe" (
    copy /Y "%CARGO_TARGET_DIR%\release\xf_tauri.exe" "portable\BraidTauri.exe"
) else if exist "target\release\xf_tauri.exe" (
    copy /Y "target\release\xf_tauri.exe" "portable\BraidTauri.exe"
)

if exist "%CARGO_TARGET_DIR%\release\server.exe" (
    copy /Y "%CARGO_TARGET_DIR%\release\server.exe" "portable\BraidServer.exe"
) else if exist "target\release\server.exe" (
    copy /Y "target\release\server.exe" "portable\BraidServer.exe"
)

if exist "%CARGO_TARGET_DIR%\release\braidfs-daemon.exe" (
    copy /Y "%CARGO_TARGET_DIR%\release\braidfs-daemon.exe" "portable\BraidDaemon.exe"
) else if exist "target\release\braidfs-daemon.exe" (
    copy /Y "target\release\braidfs-daemon.exe" "portable\BraidDaemon.exe"
)

:: Create launcher script
echo @echo off > portable\start_braid.bat
echo setlocal >> portable\start_braid.bat
echo set "BRAID_ROOT=%%~dp0braid_sync" >> portable\start_braid.bat
echo set "RUST_LOG=info" >> portable\start_braid.bat
echo if not exist "%%BRAID_ROOT%%" mkdir "%%BRAID_ROOT%%" >> portable\start_braid.bat
echo start "Braid Server" "%%~dp0BraidServer.exe" >> portable\start_braid.bat
echo timeout /t 2 /nobreak ^>nul >> portable\start_braid.bat
echo start "Braid Daemon" "%%~dp0BraidDaemon.exe" >> portable\start_braid.bat
echo timeout /t 1 /nobreak ^>nul >> portable\start_braid.bat
echo start "" "%%~dp0BraidTauri.exe" >> portable\start_braid.bat

echo.
echo ==============================================
echo   Portable Package Created Successfully!
echo ==============================================
echo.
echo Contents of portable folder:
dir /B portable\
echo.
echo To run: portable\start_braid.bat
echo ==============================================
pause
