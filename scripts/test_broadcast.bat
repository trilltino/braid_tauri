@echo off
setlocal enabledelayedexpansion

:: ========================================
:: LocalLink Broadcast E2E Test
:: ========================================
:: This script starts the server and web editor (local_link_docs),
:: then runs an automated broadcast test.
:: ========================================

set "BRAID_ROOT=%~dp0..\braid_data"
set "CARGO_TARGET_DIR=%~dp0..\target"
set "SERVER_PORT=3001"
set "WEB_PORT=5173"
set "TEST_URL=http://localhost:%SERVER_PORT%/e2e_test.md"

echo ========================================
echo   LocalLink Broadcast E2E Test
echo ========================================
echo.

:: Cleanup
echo [CLEANUP] Stopping existing processes...
taskkill /F /IM "local_link_server.exe" /T 2>nul
taskkill /F /IM "node.exe" /T 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%SERVER_PORT% ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%WEB_PORT% ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
timeout /t 2 /nobreak >nul

:: Ensure directories
if not exist "%BRAID_ROOT%" mkdir "%BRAID_ROOT%"

:: Build
echo [BUILD] Building server...
cargo build --release --package local_link_server
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

:: Install web deps (local_link_docs)
echo [BUILD] Installing web editor dependencies (local_link_docs)...
cd /d "%~dp0..\local_link_docs"
call npm install
cd /d "%~dp0"

:: ========================================
:: Start Services
:: ========================================
echo.
echo [STARTUP] Starting services...

:: Start server in background window
start "SERVER (Port %SERVER_PORT%)" cmd /c "set BRAID_ROOT=%BRAID_ROOT%&& cd /d "%~dp0.." && echo Server starting... && "%CARGO_TARGET_DIR%\release\local_link_server.exe" && pause"
timeout /t 4 /nobreak >nul

:: Verify server
echo   - Checking server...
:check_server
curl -s http://localhost:%SERVER_PORT%/health >nul 2>&1
if %ERRORLEVEL% neq 0 (
    timeout /t 1 /nobreak >nul
    goto :check_server
)
echo     OK - Server running

:: Start web editor (local_link_docs)
start "WEB EDITOR (local_link_docs, Port %WEB_PORT%)" cmd /c "cd /d "%~dp0..\local_link_docs" && npm run dev -- --port %WEB_PORT%"
timeout /t 5 /nobreak >nul

:: Verify web editor
echo   - Checking web editor...
:check_web
curl -s http://localhost:%WEB_PORT%/ >nul 2>&1
if %ERRORLEVEL% neq 0 (
    timeout /t 1 /nobreak >nul
    goto :check_web
)
echo     OK - Web editor running

:: ========================================
:: Run Automated Test
:: ========================================
echo.
echo ========================================
echo   Running Broadcast Test
echo ========================================
echo.

:: Create test file
set "TEST_FILE=%BRAID_ROOT%\peers\broadcast_test.md"
echo Initial content > "%TEST_FILE%"

:: Start client 1 subscription in background
echo [1] Starting Client 1 subscription...
start /B cmd /c "curl -s -N -H \"Subscribe: true\" -H \"Merge-Type: simpleton\" %TEST_URL% > client1_output.txt 2>&1"
timeout /t 2 /nobreak >nul

:: Start client 2 subscription in background
echo [2] Starting Client 2 subscription...
start /B cmd /c "curl -s -N -H \"Subscribe: true\" -H \"Merge-Type: simpleton\" %TEST_URL% > client2_output.txt 2>&1"
timeout /t 2 /nobreak >nul

:: Send PUT update
echo [3] Sending PUT update (simulating edit)...
curl -s -X PUT -H "Content-Type: text/plain" -H "Merge-Type: simpleton" -d "LIVE BROADCAST TEST CONTENT" %TEST_URL% >nul
echo     PUT complete

timeout /t 3 /nobreak >nul

:: Check results
echo.
echo [RESULTS] Checking broadcast results...
echo.

:: Check server log for broadcast success
echo Server broadcast status:
echo   (Look for "Broadcast sent to X receivers" in server window)
echo.

:: Check client outputs
set "CLIENT1_GOT=0"
set "CLIENT2_GOT=0"

if exist client1_output.txt (
    findstr /I "LIVE BROADCAST" client1_output.txt >nul 2>&1
    if !ERRORLEVEL! == 0 set "CLIENT1_GOT=1"
)

if exist client2_output.txt (
    findstr /I "LIVE BROADCAST" client2_output.txt >nul 2>&1
    if !ERRORLEVEL! == 0 set "CLIENT2_GOT=1"
)

:: Display results
echo Client receipts:
if "%CLIENT1_GOT%"=="1" (
    echo   [✓] Client 1 received broadcast
) else (
    echo   [ ] Client 1 - check client1_output.txt
)

if "%CLIENT2_GOT%"=="1" (
    echo   [✓] Client 2 received broadcast
) else (
    echo   [ ] Client 2 - check client2_output.txt
)

:: Final verdict
echo.
if "%CLIENT1_GOT%"=="1" if "%CLIENT2_GOT%"=="1" (
    echo ========================================
    echo   ✓ BROADCAST TEST PASSED!
    echo ========================================
) else (
    echo ========================================
    echo   ? Check output files manually:
    echo     - client1_output.txt
    echo     - client2_output.txt
    echo ========================================
)

:: Manual test instructions
echo.
echo [MANUAL TEST]
echo   Open browser to: http://localhost:%WEB_PORT%/pages
 echo   Enter URL: http://localhost:%SERVER_PORT%/test.md
 echo   Open 2 tabs, edit in one, see updates in other!
 echo.
 
 echo Press any key to stop all services...
 pause >nul
 
 :: Cleanup
 echo.
 echo [SHUTDOWN] Stopping services...
 taskkill /F /IM "local_link_server.exe" /T 2>nul
 taskkill /F /IM "node.exe" /T 2>nul
 taskkill /F /IM "curl.exe" /T 2>nul
 
 :: Clean up temp files
 del client1_output.txt 2>nul
 del client2_output.txt 2>nul
 
 echo   Done.
 timeout /t 2 /nobreak >nul
