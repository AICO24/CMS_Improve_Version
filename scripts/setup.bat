@echo off
REM Basic setup helper for local development.
echo Starting CMS local setup...
if not exist "uploads" mkdir uploads
if not exist "backend\storage\uploads" mkdir backend\storage\uploads
if not exist "backend\storage\logs" mkdir backend\storage\logs
echo Setup complete.
