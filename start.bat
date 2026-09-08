@echo off
cd /d "%~dp0"
title Stem Player
echo.
echo   Stem Player baslatiliyor...
echo   Tarayici birazdan acilacak:  http://127.0.0.1:8000
echo   Kapatmak icin bu pencerede Ctrl+C.
echo.
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start "" http://127.0.0.1:8000"
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
pause
