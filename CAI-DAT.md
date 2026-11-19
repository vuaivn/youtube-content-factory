# YouTube Content Factory — Hướng dẫn cài đặt & cập nhật

Ứng dụng web quản lý kênh / playlist / kho tài nguyên, tự dựng video và upload lên YouTube, chạy chuỗi nhiều playlist theo lịch.

> Repo **không** chứa: file đăng nhập kênh, cơ sở dữ liệu, log, kho media. Mỗi máy tự thêm kênh, kho, SEO trên giao diện web.

---

## A. Máy đã có YCF bản cũ (làm 1 lần)

Mở PowerShell:

```powershell
cd C:\youtube-content-factory
# 1. Sao lưu dữ liệu riêng
robocopy data ..\ycf-backup\data /E
robocopy secrets ..\ycf-backup\secrets /E
copy config.json ..\ycf-backup\
# 2. Kiểm tra code bị sửa tay
git status          # nếu có file "modified" → chạy: git stash
# 3. Lấy code mới
git pull
```

4. **Tắt server cũ**: đóng cửa sổ đang chạy server, hoặc dừng đúng tiến trình nghe cổng 18990 (KHÔNG tắt mọi node):
   ```powershell
   Stop-Process -Id (Get-NetTCPConnection -LocalPort 18990 -State Listen).OwningProcess
   ```
5. Chạy lại `start.bat`.

Từ đó về sau chỉ cần bấm nút **🔔 Có bản mới** trên web để cập nhật.

---

## B. Máy mới

### B1. Cài phần mềm

| Thứ cần có | Ghi chú |
|---|---|
| **Windows 10/11** | Thumbnail dùng font Windows, lịch hẹn phụ đề dùng Task Scheduler |
| **Node.js 22+** | https://nodejs.org (bản LTS). Không cần `npm install` |
| **Git** | https://git-scm.com |
| **ffmpeg + ffprobe** | https://www.gyan.dev/ffmpeg/builds/ — đặt `ffmpeg.exe` và `ffprobe.exe` vào `C:\ffmpeg` |
| Ổ đĩa trống | **≥ 15 GB** cho thư mục dựng tạm (video 4 giờ cần ~12 GB) |
| Tài khoản Google Cloud | Một *OAuth client* loại Desktop (mục B4) |

### B2. Tải code

```powershell
cd C:\
git clone https://github.com/vuaivn/youtube-content-factory.git
```

### B3. Tạo `config.json`

Chép `config.example.json` thành `config.json` (cùng thư mục) rồi sửa:

| Khoá | Ý nghĩa | Ví dụ |
|---|---|---|
| `port` | Cổng web | `18990` |
| `secretsDir` | Nơi lưu file đăng nhập kênh | `secrets` |
| `workDir` | Thư mục dựng tạm, ổ còn ≥ 15 GB trống | `C:/ycf-work` |
| `ffmpeg` | Đường dẫn ffmpeg.exe (ffprobe cùng thư mục) | `C:/ffmpeg/ffmpeg.exe` |
| `episodeFile` | File đếm số tập | `data/episode.json` |
| `thumbnailFont` | Font chữ thumbnail | `C:/Windows/Fonts/timesbd.ttf` |
| `oauthClient` | Client ID + Secret Google (OAuth client loại **Desktop**, redirect `http://127.0.0.1:8737`) | |
| `telegram` | Báo tin khi xong mỗi kênh (tuỳ chọn) | `"enabled": false` |

Dùng dấu `/` trong đường dẫn. Đường dẫn tương đối tính từ thư mục app.

### B4. Tạo OAuth client Google (làm 1 lần)

1. Vào https://console.cloud.google.com → tạo Project (hoặc dùng project có sẵn).
2. **APIs & Services → Library** → bật **YouTube Data API v3**.
3. **OAuth consent screen**: loại *External*, điền tên app + email. Thêm các tài khoản Google của kênh vào *Test users*.
   ⚠️ **Bấm "PUBLISH APP" (In production)** — nếu để *Testing*, đăng nhập kênh **tự hết hạn sau 7 ngày**.
4. **Credentials → Create credentials → OAuth client ID** → loại **Desktop app**.
5. Chép **Client ID** và **Client secret** vào `config.json` → `oauthClient`.

> Có thể dùng chung OAuth client của máy cũ (Client ID/Secret giống nhau ở mọi máy).

---

### B5. Chạy app

- **Chạy thử:** bấm đúp `start.bat`, mở `http://127.0.0.1:18990`.
- **Tự chạy khi bật máy:** chuột phải `cai-tu-chay.bat` → **Run as administrator** (tạo task `YCF-server`, tài khoản SYSTEM).
- **Kho media nằm trên ổ ảo (`subst`)?** Tài khoản SYSTEM không thấy ổ ảo của user. Tạo file `subst.txt` cạnh `start.bat`, mỗi dòng một ổ:
  ```
  D: C:\Disk-D
  ```

Kiểm tra nhanh: `node test\test-plan.mjs` và `node test\test-executor.mjs`.

### B6. Thiết lập trên giao diện web

Làm theo đúng thứ tự:

1. **Kênh & Playlist → ➕ Thêm kênh mới**: đặt mã kênh (vd `alta`) → bấm *Mở trang đăng nhập Google* → chọn đúng tài khoản kênh → *Cho phép* → trang lỗi `127.0.0.1:8737` hiện ra (**bình thường**) → copy **toàn bộ địa chỉ** trên thanh URL → dán vào ô → *Lưu*. App tự lấy tên kênh, tạo kho chữ/SEO riêng cho kênh.
2. **Kho tài nguyên → + Tạo kho**: chọn loại (hook / chuyện / outro / video shot / nhạc nền), nhập đường dẫn thư mục → *Quét lại*. Hook/chuyện/outro **thiếu `.srt` sẽ bị từ chối**.
3. **Kho chữ & SEO**: chọn kênh + kho → ô **📁 Thư mục SEO**: nhập đường dẫn thư mục SEO (chuẩn `docs/CHUAN-KHO-SEO.md`) → **Lưu** → app quét và báo số mục + lỗi từng dòng. Sửa file rồi bấm **Quét lại** (app cũng tự quét trước mỗi lần dựng). Để trống ô này thì nhập tay trên web như cũ.
4. **Kênh & Playlist → + Thêm playlist**: ID playlist YouTube, công thức (tổng phút, số truyện, hình nền, màn đen), tick kho từng loại, chọn kho chữ/SEO → *Xem trước* → *Lưu*.
5. **Chạy chuỗi**: tick playlist, sắp thứ tự → *Chạy ngay* hoặc *Lưu thành lịch mỗi ngày* (giờ Việt Nam).

Mỗi video: dựng → kiểm tra (thời lượng, fade, phụ đề) → upload **Riêng tư** → hẹn đăng phụ đề sau 6 giờ → dọn file tạm → sang kênh sau. Chỉ một kênh chạy một lúc.

---

### B7. Mở giao diện từ xa (tuỳ chọn)

Cài **Tailscale** (https://tailscale.com) trên máy chạy app và trên điện thoại/laptop, cùng một tài khoản. App tự nhận IP Tailscale (`100.x.x.x`) và mở thêm ở `http://100.x.x.x:18990`. Mở cổng trong Windows Firewall chỉ cho dải Tailscale (PowerShell admin):
```
netsh advfirewall firewall add rule name="YCF Tailscale" dir=in action=allow protocol=TCP localport=18990 remoteip=100.64.0.0/10
```
⚠️ **Không** mở cổng ra Internet — app chưa có đăng nhập.

---


```
node test\test-plan.mjs        (công thức — không cần dữ liệu)
node test\test-executor.mjs    (logic dựng — không cần dữ liệu)
```
Sau khi đã có kho + playlist: bấm **Lập kế hoạch** ở trang Sản xuất, rồi chạy chuỗi 1 playlist để dựng thật.

---

## Lưu ý

- Dữ liệu **riêng mỗi máy**: `config.json`, `data/`, `secrets/`, `logs/`, `captions/` — cập nhật không đụng tới.
- **Không** copy `secrets/` giữa các máy (mỗi máy tự đăng nhập kênh).
- Cập nhật = bấm **🔔** trên web (tự sao lưu vào `backups\`, tự ROLLBACK nếu lỗi) hoặc bấm đúp `cap-nhat.bat`. Nhật ký: `logs\update.log`.
- Báo **"HỦY: code bị sửa tay"** → chạy `git stash` trong thư mục app rồi cập nhật lại.

---

## Dành cho người phát triển

Sửa code → tăng `VERSION` (semver) + ghi `CHANGELOG.md` → push lên `main`. Mọi commit lên `main` là bản các máy nhận được.

---

## Lỗi thường gặp

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| `start.bat` báo không tìm thấy Node | Cài Node.js, mở lại cửa sổ |
| Task tự chạy không lên khi bật máy | Chạy lại `cai-tu-chay.bat` bằng quyền admin; xem `logs\server.log` |
| Quét kho báo thư mục không tồn tại khi chạy bằng task | Ổ ảo `subst` → khai trong `subst.txt` |
| "Chưa có OAuth client" khi thêm kênh | Điền `oauthClient` trong `config.json`, khởi động lại app |
| Kênh "HẾT HẠN đăng nhập" sau ~7 ngày | Consent screen còn *Testing* → PUBLISH APP, rồi Đăng nhập lại |
| "Không đủ chỗ trống" / dừng giữa chừng | `workDir` ở ổ còn ít chỗ → chuyển sang ổ ≥ 15 GB trống |
| Chữ thumbnail lỗi font | Sửa `thumbnailFont` trỏ tới file `.ttf` có trên máy |
| Video có nhạc câm / thiếu file | Bấm *Soát* ở kho — file đã mất trên ổ sẽ bị loại khỏi danh sách bốc |

---

## Cấu trúc thư mục

```
server/           máy chủ web + bộ dựng (Node, không thư viện ngoài)
  config.mjs      đọc config.json
  db/             SQLite (node:sqlite) — tự tạo data/factory.db lần đầu
  recipe/         lập kế hoạch dựng, kiểm kho
  execute/        dựng (compose2), kiểm tra, upload, chạy chuỗi, đăng nhập kênh
public/           giao diện web
vendor/           script upload YouTube
test/             kiểm thử
data/ logs/ secrets/ captions/   tự sinh — KHÔNG đưa lên git
```
