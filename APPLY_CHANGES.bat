@echo off
REM Product Allocation Enhancement - Quick Apply Script (Windows)
REM Run this from the project root: APPLY_CHANGES.bat

echo.
echo ===============================================
echo   Product Allocation Enhancements
echo ===============================================
echo.

REM Step 1: Backup existing files
echo [1/4] Creating backups...
copy imports\api\allocations.js imports\api\allocations.js.backup >nul
copy imports\ui\ProductAllocation.jsx imports\ui\ProductAllocation.jsx.backup >nul
echo ✓ Backups created
echo.

REM Step 2: Apply allocations.js changes
echo [2/4] Updating allocations.js...
copy /Y imports\api\allocations_UPDATED.js imports\api\allocations.js >nul
echo ✓ allocations.js updated
echo.

REM Step 3: Apply ProductAllocation.jsx changes
echo [3/4] Updating ProductAllocation.jsx...
copy /Y imports\ui\ProductAllocation_UPDATED.jsx imports\ui\ProductAllocation.jsx >nul
echo ✓ ProductAllocation.jsx updated
echo.

REM Step 4: Remind about server/main.js
echo [4/4] Manual step required:
echo.
echo ⚠ IMPORTANT: Add server methods manually
echo    File: server\main.js
echo    Source: SERVER_METHODS_TO_ADD.js
echo    Location: After line 3656 (after allocations.create)
echo    Methods: allocations.update and allocations.delete
echo.

REM Step 5: Clean up temp files
echo Cleaning up temporary files...
del /Q imports\api\allocations_UPDATED.js 2>nul
del /Q imports\ui\ProductAllocation_UPDATED.jsx 2>nul
echo ✓ Cleanup complete
echo.

echo ===============================================
echo   ✨ Installation Complete!
echo ===============================================
echo.
echo Next steps:
echo   1. Add server methods from SERVER_METHODS_TO_ADD.js
echo   2. Restart Meteor if running: npm start
echo   3. Test allocation features
echo.
echo See IMPLEMENTATION_SUMMARY.md for details
echo.
pause
