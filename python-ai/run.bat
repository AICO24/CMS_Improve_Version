@echo off
setlocal
cd /d "%~dp0"

if exist .venv\Scripts\python.exe (
    set "PYTHON_CMD=.venv\Scripts\python.exe"
) else (
    where py >nul 2>nul
    if not errorlevel 1 (
        set "PYTHON_CMD=py -3"
    ) else (
        set "PYTHON_CMD=python"
    )
)

"%PYTHON_CMD%" app.py
