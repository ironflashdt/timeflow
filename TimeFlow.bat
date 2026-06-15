@echo off
setlocal EnableDelayedExpansion
title TimeFlow
cd /d "%~dp0"

echo ============================================
echo    TimeFlow - lancement de l'application...
echo ============================================
echo.

REM 1) Liberer le port 3000 (ancienne instance eventuelle)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1

REM 2) Demarrer Ollama si installe (IA locale) - sinon l'IA deterministe suffit
where ollama >nul 2>&1 && start "" /min ollama serve

REM 3) Demarrer le moteur TimeFlow (fenetre minimisee - NE PAS FERMER tant que vous utilisez l'app)
start "TimeFlow - moteur (ne pas fermer)" /min cmd /c "node server.js"

REM 4) Attendre que le serveur reponde (max ~40s)
echo Demarrage du moteur, patientez...
set /a _n=0
:wait
ping -n 2 127.0.0.1 >nul
powershell -NoProfile -Command "try{(Invoke-WebRequest 'http://localhost:3000/' -UseBasicParsing -TimeoutSec 2)^|Out-Null;exit 0}catch{exit 1}"
if errorlevel 1 (
  set /a _n+=1
  if !_n! lss 40 goto wait
  echo.
  echo [!] Le moteur n'a pas demarre. Verifiez que Node.js est installe (node -v).
  echo     Ouverture quand meme dans le navigateur par defaut...
  start "" "http://localhost:3000/app"
  goto end
)

REM 5) Ouvrir en MODE APPLICATION : fenetre dediee, sans onglets ni barre d'adresse.
REM    On utilise le moteur Chrome/Edge deja installe -> la reconnaissance vocale fonctionne.
set "URL=http://localhost:3000/app"
set "PROFILE=%LOCALAPPDATA%\TimeFlowApp"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "!CHROME!" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "!EDGE!" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if exist "!CHROME!" (
  start "" "!CHROME!" --app=!URL! --user-data-dir="!PROFILE!" --new-window
) else if exist "!EDGE!" (
  start "" "!EDGE!" --app=!URL! --user-data-dir="!PROFILE!" --new-window
) else (
  echo Chrome/Edge introuvable - ouverture dans le navigateur par defaut.
  start "" "!URL!"
)

:end
REM La fenetre du moteur reste ouverte (minimisee). Cette fenetre-ci peut se fermer.
exit
