@echo off
setlocal
cd /d "%~dp0"
set "TARGET=%~dp0TimeFlow.bat"
set "WORK=%~dp0"
set "ICON=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%ICON%" set "ICON=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%ICON%" set "ICON=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%ICON%" set "ICON=%SystemRoot%\System32\shell32.dll"

powershell -NoProfile -Command "$d=[Environment]::GetFolderPath('Desktop'); $w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut((Join-Path $d 'TimeFlow.lnk')); $s.TargetPath='%TARGET%'; $s.WorkingDirectory='%WORK%'; $s.IconLocation='%ICON%,0'; $s.WindowStyle=7; $s.Description='TimeFlow - agenda intelligent'; $s.Save()"

echo.
echo Raccourci "TimeFlow" cree sur le Bureau.
echo Double-cliquez dessus pour lancer l'application.
echo.
pause
