@echo off
cd /d %~dp0
set /p GOODS_SIGN=Paste goods_sign: 
curl -X POST http://localhost:3000/api/pdd/link -H "Content-Type: application/json" -d "{\"goods_sign\":\"%GOODS_SIGN%\"}"
echo.
pause
