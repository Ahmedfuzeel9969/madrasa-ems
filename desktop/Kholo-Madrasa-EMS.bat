@echo off
chcp 65001 >nul
title Madrasa EMS Launcher
echo.
echo  Madrasa EMS — Desktop Launcher
echo  ==============================
echo.

taskkill /F /IM "Madrasa EMS.exe" >nul 2>&1
timeout /t 1 /nobreak >nul

set "EXE=%~dp0release-regent62\win-unpacked\Madrasa EMS.exe"
if not exist "%EXE%" (
    set "EXE=%~dp0release-regent61\win-unpacked\Madrasa EMS.exe"
)
if not exist "%EXE%" (
    set "EXE=%~dp0release-regent59\win-unpacked\Madrasa EMS.exe"
)
if not exist "%EXE%" (
    set "EXE=%~dp0release-regent57\win-unpacked\Madrasa EMS.exe"
)
if not exist "%EXE%" (
    set "EXE=%~dp0release-regent56\win-unpacked\Madrasa EMS.exe"
)
if not exist "%EXE%" (
    set "EXE=%~dp0release-regent55\win-unpacked\Madrasa EMS.exe"
)
if not exist "%EXE%" (
    echo ERROR: Madrasa EMS.exe not found.
    echo Build first: npm run build:hosting
    echo Then: npx electron-builder --win portable --config.directories.output=desktop/release-regent60
    pause
    exit /b 1
)

echo Starting: %EXE%
start "" "%EXE%"
echo.
echo App started. Data folder: %USERPROFILE%\Documents\MadrasaEMS_Data
timeout /t 3 /nobreak >nul
