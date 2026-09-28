@echo off
title Cloudflare Tunnel - CMS Live Share
cls
echo ========================================================
echo         CMS LIVE SHARE (CLOUDFLARE TUNNEL)
echo ========================================================
echo.
echo 1. Sinisigurado na bukas ang Laragon (Apache)...
echo 2. Kinokonekta ang CMS.test sa Cloudflare...
echo.
echo Hanapin sa ibaba ang linyang may:
echo   "https://xxxx-xxxx.trycloudflare.com"
echo.
echo Paalala: HUWAG ISASARA ang window na ito habang nagsha-share!
echo ========================================================
echo.
"C:\laragon\bin\cloudflared.exe" tunnel --url http://localhost:80 --http-host-header CMS.test
pause
