@echo off
echo =================================
echo Meteor Cache Reset Script
echo =================================
echo.
echo This will reset Meteor's local cache to ensure clean database connections.
echo.
echo WARNING: This will remove all local data!
echo Press Ctrl+C to cancel or any key to continue...
pause > nul

echo.
echo 1. Stopping any running Meteor processes...
taskkill /F /IM node.exe 2>nul
timeout /t 2 > nul

echo.
echo 2. Deleting .meteor\local folder...
if exist .meteor\local (
    rmdir /S /Q .meteor\local
    echo    - Local cache deleted
) else (
    echo    - No local cache found
)

echo.
echo 3. Running meteor reset...
call meteor reset

echo.
echo 4. Clearing npm cache...
call npm cache clean --force

echo.
echo =================================
echo Reset complete!
echo =================================
echo.
echo Now start Meteor with:
echo meteor run --settings settings.json
echo.
echo Or use:
echo npm start
echo.
pause