@echo off
rem Cap nhat YouTube Content Factory tu GitHub (sao luu du lieu, tu rollback neu loi). Log: logs\update.log
rem Chay tay: bam dup file nay. App goi tu nut "Cap nhat" voi tham so --auto.
cd /d "%~dp0"
set AUTO=
if /i "%~1"=="--auto" set AUTO=-Auto
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update.ps1" %AUTO%
set RC=%ERRORLEVEL%
if not defined AUTO pause
exit /b %RC%
