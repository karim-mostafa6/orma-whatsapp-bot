@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup') + '\ORMA WhatsApp Bot.lnk'); $s.TargetPath='%~dp0START-BOT.bat'; $s.WorkingDirectory='%~dp0'; $s.Save()"
if errorlevel 1 (
  echo Something went wrong.
) else (
  echo Done. The bot will now start by itself every time you turn on the computer.
  echo To undo: press Win+R, type shell:startup, and delete "ORMA WhatsApp Bot".
)
pause
