@echo off
rem Cai Scheduled Task "YCF-server": tu chay app khi bat may (tai khoan SYSTEM, chay bu, tu khoi dong lai neu chet).
rem Chuot phai -> Run as administrator.
cd /d "%~dp0"
set NODE_EXE=
for /f "delims=" %%n in ('where node 2^>nul') do if not defined NODE_EXE set NODE_EXE=%%n
if not defined NODE_EXE ( echo [LOI] Chua cai Node.js & pause & exit /b 1 )
rem SYSTEM khong co PATH cua user -> ghi duong dan node tuyet doi vao start-system.bat
(
  echo @echo off
  echo cd /d "%~dp0"
  echo if not exist logs mkdir logs
  echo if exist subst.txt for /f "usebackq tokens=1,2" %%%%a in ^("subst.txt"^) do subst %%%%a %%%%b ^>nul 2^>^&1
  echo "%NODE_EXE%" server\server.mjs ^>^> logs\server.log 2^>^&1
) > start-system.bat
schtasks /Create /TN "YCF-server" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "\"%~dp0start-system.bat\"" /F
powershell -NoProfile -Command "$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0; Set-ScheduledTask -TaskName 'YCF-server' -Settings $s | Out-Null"
schtasks /Run /TN "YCF-server"
echo.
echo Da cai xong. Mo http://127.0.0.1:18990 de dung.
pause
