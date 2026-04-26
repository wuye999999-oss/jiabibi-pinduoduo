@echo off
chcp 65001 >nul
cd /d %~dp0
start "" index.html
echo Jiabibi Web v4 opened.
echo Keep jiabibi-api/start.bat running.
pause
