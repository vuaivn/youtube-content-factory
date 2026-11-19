# update.ps1 - cập nhật YouTube Content Factory từ GitHub (gọi qua cap-nhat.bat).
# An toàn: chỉ fast-forward, sao lưu data/secrets/config.json trước, tự rollback nếu server không lên.
# Không bao giờ đụng: config.json, data\, secrets\, logs\, captions\, work\ (đều gitignore).
param([switch]$Auto, [string]$Remote = 'origin', [string]$Branch = 'main')
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Port = 18990
New-Item -ItemType Directory -Force -Path "$Root\logs" | Out-Null
$LogFile = "$Root\logs\update.log"
$Utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $Utf8 # đọc đúng tiếng Việt từ output git
$env:GIT_TERMINAL_PROMPT = '0'; $env:GCM_INTERACTIVE = 'never' # SYSTEM không có màn hình: lỗi ngay thay vì treo chờ đăng nhập
function Log($m) { $l = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $m"; Write-Host $l; [IO.File]::AppendAllText($LogFile, $l + "`r`n", $Utf8) }

$GitExe = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $GitExe) { foreach ($p in "$env:ProgramFiles\Git\cmd\git.exe", "${env:ProgramFiles(x86)}\Git\cmd\git.exe") { if (Test-Path $p) { $GitExe = $p; break } } }
function G { $out = & $GitExe -c safe.directory=* -C $Root @args 2>&1; $script:GitRc = $LASTEXITCODE; ($out | Out-String).Trim() }

function ListenPid { (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess }
function StopServer {
  $wait = if ($Auto) { 30 } else { 0 }
  for ($i = 0; $i -lt $wait -and (ListenPid); $i++) { Start-Sleep 1 }
  $p = ListenPid
  if ($p) { Log "Dừng server PID $p (đang nghe cổng $Port)"; Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Start-Sleep 2 }
}
function StartServer {
  $hasTask = $false
  & schtasks.exe /query /tn YCF-server *> $null; if ($LASTEXITCODE -eq 0) { $hasTask = $true }
  if ($hasTask) { Log 'Khởi động server: schtasks /run /tn YCF-server'; & schtasks.exe /run /tn YCF-server *> $null }
  else { Log 'Khởi động server: start.bat (chạy nền)'; Start-Process -FilePath cmd.exe -ArgumentList '/c', "`"$Root\start.bat`"" -WorkingDirectory $Root -WindowStyle Hidden }
}
function Healthy([int]$sec = 60) {
  if ($env:YCF_UPDATE_FORCE_FAIL -eq '1' -or (Test-Path "$Root\logs\force-update-fail.flag")) { Log 'TEST: ép health-check thất bại'; Start-Sleep 3; return $false }
  $t = (Get-Date).AddSeconds($sec)
  while ((Get-Date) -lt $t) {
    try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://127.0.0.1:$Port/api/update/check"; if ($r.StatusCode -eq 200) { $want = (G rev-parse --short HEAD); $got = ($r.Content | ConvertFrom-Json).head; if (-not $got -or $got -eq $want) { return $true } } <# đúng bản code vừa checkout, không nhận nhầm server cũ #> } catch {}
    Start-Sleep 2
  }
  return $false
}
function Abort($why) { Log "HỦY: $why"; StartServer; if (Healthy 60) { Log 'Server bản cũ đã chạy lại.' } else { Log 'CẢNH BÁO: server chưa lên lại, xem logs\server.log' }; exit 1 }

Log "===== Bắt đầu cập nhật (auto=$Auto, remote=$Remote/$Branch) ====="
if (-not $GitExe) { Log 'Không tìm thấy git'; StopServer; Abort 'thiếu git' }
StopServer
$Old = G rev-parse HEAD
Log "Phiên bản hiện tại: $Old"
$f = G fetch $Remote; if ($GitRc -ne 0) { Abort "git fetch lỗi: $f" }
$dirty = G status --porcelain --untracked-files=no
if ($dirty) { Abort "có file đã sửa trong repo (không ghi đè):`r`n$dirty" }
G merge-base --is-ancestor "$Remote/$Branch" HEAD | Out-Null
if ($GitRc -eq 0) { Log 'Không có gì mới - đã mới nhất.'; StartServer; if (Healthy 60) { Log 'Server đã chạy lại. XONG.'; exit 0 } else { Log 'CẢNH BÁO: server chưa lên lại'; exit 1 } }
G merge-base --is-ancestor HEAD "$Remote/$Branch" | Out-Null
if ($GitRc -ne 0) { Abort "HEAD không phải tổ tiên của $Remote/$Branch (nhánh đã rẽ) - không cập nhật tự động" }

# sao lưu
$Bk = "$Root\backups\$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Force -Path $Bk | Out-Null
foreach ($d in 'data', 'secrets') { if (Test-Path "$Root\$d") { & robocopy.exe "$Root\$d" "$Bk\$d" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null; if ($LASTEXITCODE -ge 8) { Abort "sao lưu $d lỗi (robocopy $LASTEXITCODE)" } } }
if (Test-Path "$Root\config.json") { Copy-Item "$Root\config.json" "$Bk\config.json" }
Log "Đã sao lưu vào $Bk"
Get-ChildItem "$Root\backups" -Directory | Where-Object Name -match '^\d{8}-\d{6}$' | Sort-Object Name -Descending | Select-Object -Skip 5 | ForEach-Object { Log "Xóa bản sao lưu cũ $($_.Name)"; Remove-Item $_.FullName -Recurse -Force }

$m = G merge --ff-only "$Remote/$Branch"
if ($GitRc -ne 0) { Abort "git merge --ff-only lỗi: $m" }
Log "Đã cập nhật $Old -> $(G rev-parse HEAD) (VERSION $((Get-Content "$Root\VERSION" -ErrorAction SilentlyContinue)))"
StartServer
if (Healthy 60) { Log 'Server bản mới chạy tốt. XONG.'; exit 0 }

Log "ROLLBACK: server bản mới không lên sau 60s -> quay về $Old"
StopServer
G reset --hard $Old | ForEach-Object { Log $_ }
StartServer
$env:YCF_UPDATE_FORCE_FAIL = $null; if (Test-Path "$Root\logs\force-update-fail.flag") { Remove-Item "$Root\logs\force-update-fail.flag" }
if (Healthy 60) { Log 'ROLLBACK xong, server bản cũ đã chạy lại.' } else { Log 'CẢNH BÁO: sau ROLLBACK server vẫn chưa lên, xem logs\server.log' }
exit 2
