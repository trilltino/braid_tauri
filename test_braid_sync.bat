@echo off
REM Test BraidFS Sync

echo ========================================
echo Testing Braid Services (Server + Daemon)
echo ========================================
echo.

REM Check if Chat Server is running
echo [1/2] Checking Chat Server (port 3001)...
netstat -an | findstr "3001" | findstr "LISTENING" >nul
if errorlevel 1 (
    echo [WARNING] Chat Server not running on port 3001
    echo Mail/Feed features will not work.
    echo.
) else (
    echo [OK] Chat Server is running!
)

REM Check if daemon is running
echo [2/2] Checking BraidFS Daemon (port 45678)...
netstat -an | findstr "45678" | findstr "LISTENING" >nul
if errorlevel 1 (
    echo [ERROR] Daemon not running on port 45678
    echo Please run .\ide.bat first (starts both Server and Daemon)
    pause
    exit /b 1
) else (
    echo [OK] Daemon is running!
)
echo.

echo [1] Checking local file before sync...
if exist braid_sync\braid.org\tino_tauri (
    echo     File exists, size: 
    for %%F in (braid_sync\braid.org\tino_tauri) do echo     %%~zF bytes
) else (
    echo     File does not exist yet
)

echo.
echo [2] Current daemon status:
curl -s http://127.0.0.1:45678/status 2>nul || echo     Daemon API not responding
echo.

echo [3] To sync manually, type this in the daemon window:
echo     sync https://braid.org/tino_tauri
echo.

echo [4] After sync, check file again:
echo     type braid_sync\braid.org\tino_tauri
echo.

echo ========================================
echo Next steps:
echo 1. In the daemon window, type: sync https://braid.org/tino_tauri
echo 2. Wait for "Subscribing to..." message
echo 3. Check if file gets content: type braid_sync\braid.org\tino_tauri
echo 4. Edit the file in your IDE and save
echo 5. The daemon will push changes back to braid.org
echo ========================================
