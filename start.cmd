@echo off
setlocal
cd /d "%~dp0"
if exist ".tools\node\node.exe" (
  ".tools\node\node.exe" --env-file-if-exists=.env server.mjs
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Please install Node.js 22.9 or newer from https://nodejs.org then run this file again.
    pause
    exit /b 1
  )
  node --env-file-if-exists=.env server.mjs
)
if errorlevel 1 pause
