@echo off
title TimeFlow
echo ==========================================
echo    TimeFlow - Demarrage en cours...
echo ==========================================
echo.

echo [1/3] Liberation du port 3000 (ancienne instance)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo [2/3] Demarrage d'Ollama (IA locale gratuite)...
start "" ollama serve
timeout /t 4 /nobreak > nul

echo [3/3] Demarrage du serveur TimeFlow...
cd /d "%~dp0"
node server.js

pause
