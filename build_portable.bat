@echo off
setlocal
cd /d %~dp0

echo ==============================================
echo   Braid Tauri - Portable Build Script
echo ==============================================
echo.

:: 1. Navigate to xf_tauri
echo [1/2] Building Braid Tauri via Tauri CLI...
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

:: 2. Back to root
cd ..

:: 3. Locate and Copy Binary
echo [2/2] Finalizing portable executable...
if exist "target\release\xf_tauri.exe" (
    copy /Y "target\release\xf_tauri.exe" "BraidTauri-Portable.exe"
    echo.
    echo SUCCESS: Portable binary created at [BraidTauri-Portable.exe]
) else (
    echo.
    echo [ERROR] Could not find target\release\xf_tauri.exe
    pause
    exit /b 1
)

echo.
echo ==============================================
echo   Portable EXE Created Successfully!
echo ==============================================
pause
