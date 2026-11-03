@echo off
REM Build DevAtServGUI packages for Windows
REM Usage: build.bat [--pack | --portable]
REM   --pack  Build unpacked directory only (faster, for testing)
REM   --portable Build portable executable (.exe)
REM   (default) Build NSIS installer (.exe)

cd /d "%~dp0"

echo [1/3] Checking prerequisites...
where node >nul 2>&1 || (echo ERROR: Node.js not found in PATH && exit /b 1)
where npm >nul 2>&1 || (echo ERROR: npm not found in PATH && exit /b 1)

echo [2/3] Installing dependencies...
if not exist node_modules (
    call npm ci
    if errorlevel 1 (
        echo ERROR: npm ci failed
        exit /b 1
    )
)

echo [3/4] Getting the MicroserviceBase and bridge wheels...
REM MSB_SRC: a checkout of the base repo to build MicroserviceBase from;
REM without it the version installer.nsh names comes from the package index.
if not exist "%PYTHON_PATH%" (
    echo WARNING: Python not found at %PYTHON_PATH%, skipping the wheels
    goto skip_wheel
)
"%PYTHON_PATH%" "%~dp0build-resources\fetch_wheels.py"
if errorlevel 1 echo WARNING: wheels missing, the installer will fall back to the package index
:skip_wheel

echo [4/4] Building...
if "%1"=="--pack" (
    echo Building unpacked directory...
    call npx electron-builder --dir
) else if "%1"=="--portable" (
    echo Building portable executable...
    call npx electron-builder --win portable --x64
) else (
    echo Building NSIS installer...
    call npx electron-builder --win --x64
)

if errorlevel 1 (
    echo ERROR: Build failed
    exit /b 1
)

echo.
echo Build complete. Output in dist\
