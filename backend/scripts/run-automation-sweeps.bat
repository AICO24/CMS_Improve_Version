@echo off
REM Cemetery Management System - Automated Background Sweeps Runner
REM Executes reservation policy sweeps, warnings, auto-cancellations, and lot expiration syncs.

set PHP_BIN=C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe
if not exist "%PHP_BIN%" (
    set PHP_BIN=php
)

cd /d "%~dp0\..\.."
"%PHP_BIN%" backend\scripts\run-automation-sweeps.php
