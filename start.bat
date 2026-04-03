@echo off
title FileShare - Local P2P File Transfer
echo.
echo  ╔══════════════════════════════════════╗
echo  ║         FileShare Starting...        ║
echo  ╚══════════════════════════════════════╝
echo.
cd /d "%~dp0"
py -m uvicorn main:app --host 0.0.0.0 --port 8000
pause
