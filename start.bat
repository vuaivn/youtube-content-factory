@echo off
rem Khoi dong YouTube Content Factory (chay duoc o moi may, moi thu muc).
rem Dung chung cho: chay tay (bam dup) va Scheduled Task tu chay khi bat may (cai-tu-chay.bat).
cd /d "%~dp0"
if not exist logs mkdir logs
rem Neu kho media nam tren o ao (subst) thi tai khoan SYSTEM khong thay -> khai trong subst.txt, moi dong: D: C:\ai-data
if exist subst.txt for /f "usebackq tokens=1,2" %%a in ("subst.txt") do subst %%a %%b >nul 2>&1
where node >nul 2>&1
if errorlevel 1 (
  echo [LOI] Khong tim thay Node.js. Cai Node 22 tro len: https://nodejs.org
  exit /b 1
)
node server\server.mjs >> logs\server.log 2>&1
