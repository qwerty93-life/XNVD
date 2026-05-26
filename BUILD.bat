@echo off
title XNVD Launcher — Build
color 0D
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║          XNVD Launcher — Build Tool              ║
echo  ╚══════════════════════════════════════════════════╝
echo.
echo  HOW TO UPDATE THE LAUNCHER:
echo  ─────────────────────────────────────────────────
echo   1. Edit any file:
echo        renderer\index.html   ^← layout / pages
echo        renderer\styles.css   ^← all colors / fonts
echo        renderer\app.js       ^← all UI logic
echo        src\minecraft.js      ^← launch / install
echo        src\cosmetics.js      ^← capes
echo        src\updater.js        ^← set your GitHub name!
echo.
echo   2. Run this BUILD.bat to compile a new EXE.
echo.
echo   3. To release an update:
echo        a. Bump version in package.json (e.g. 1.1.0)
echo        b. Run BUILD.bat
echo        c. Upload dist\*.exe to GitHub Releases as vX.Y.Z
echo        d. Everyone gets the banner next time they open
echo  ─────────────────────────────────────────────────
echo.

set /p CONFIRM="Press Enter to start building (or Ctrl+C to cancel)... "

echo.
echo [1/2] Installing / updating dependencies...
call npm install
if errorlevel 1 (
    echo.
    echo  ERROR: npm install failed.
    pause & exit /b 1
)

echo.
echo [2/2] Building installer + portable EXE...
call npm run build
if errorlevel 1 (
    echo.
    echo  ERROR: Build failed. See above for details.
    pause & exit /b 1
)

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║  Build complete!  Output → dist\                 ║
echo  ║                                                  ║
echo  ║  Installer : XNVD Launcher Setup 1.0.0.exe      ║
echo  ║  Portable  : XNVD-Launcher-Portable-1.0.0.exe   ║
echo  ╚══════════════════════════════════════════════════╝
echo.
explorer dist
pause
