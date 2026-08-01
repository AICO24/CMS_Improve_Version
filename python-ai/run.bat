@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 (
    set "PYTHON_CMD=py -3"
) else (
    where python >nul 2>nul
    if not errorlevel 1 (
        set "PYTHON_CMD=python"
    ) else (
        echo Python was not found. Please install Python 3.12+ and try again.
        exit /b 1
    )
)

if not exist venv (
    %PYTHON_CMD% -m venv venv
)

call venv\Scripts\activate.bat
%PYTHON_CMD% -m pip install -r requirements.txt
%PYTHON_CMD% app.py
