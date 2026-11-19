# YouTube Content Factory — Hướng dẫn cài đặt trên máy mới

Ứng dụng web quản lý kênh / playlist / kho tài nguyên, tự dựng video (giọng đọc + nhạc nền + hình + phụ đề + fade) và upload lên YouTube, chạy chuỗi nhiều playlist theo lịch.

> Repo **không** chứa: file đăng nhập kênh, cơ sở dữ liệu, log, kho media. Máy mới tự thêm kênh, thêm kho, thêm kho SEO trên giao diện web.

---

## 1. Yêu cầu máy

| Thứ cần có | Ghi chú |
|---|---|
| **Windows 10/11** | Thumbnail dùng font Windows, lịch hẹn phụ đề dùng Task Scheduler |
| **Node.js 22.5 trở lên** | https://nodejs.org (bản LTS). Không cần `npm install` — app không dùng thư viện ngoài |
| **ffmpeg + ffprobe** | https://www.gyan.dev/ffmpeg/builds/ → bản *release essentials*, giải nén vào `C:\ffmpeg` |
| Ổ đĩa trống | **≥ 15 GB** ở ổ chứa thư mục dựng tạm (video 4 giờ cần ~12 GB lúc dựng) |
| Kho media | Thư mục chứa giọng đọc (`.mp3` + `.srt` cùng tên), video shot (`.mp4`), nhạc nền |
| Tài khoản Google Cloud | Một *OAuth client* để đăng nhập kênh YouTube (bước 4) |

---

## 2. Tải code

**Cách 1 — có git:**
```
git clone https://github.com/<tai-khoan>/youtube-content-factory.git C:\youtube-content-factory
```
**Cách 2 — không có git:** trên GitHub bấm **Code → Download ZIP**, giải nén vào `C:\youtube-content-factory`.

---

## 3. Tạo file cấu hình `config.json`

Chép `config.example.json` thành `config.json` (cùng thư mục) rồi sửa:

| Khoá | Ý nghĩa | Ví dụ |
|---|---|---|
| `port` | Cổng web | `18990` |
| `secretsDir` | Nơi lưu file đăng nhập kênh (tự tạo) | `secrets` |
| `workDir` | Thư mục dựng tạm — đặt ở ổ còn nhiều chỗ | `C:/ycf-work` |
| `ffmpeg` | Đường dẫn ffmpeg.exe (ffprobe phải nằm cùng thư mục) | `C:/ffmpeg/bin/ffmpeg.exe` |
| `episodeFile` | File đếm số tập (tiêu đề "Số N") | `data/episode.json` |
| `thumbnailFont` | Font chữ thumbnail | `C:/Windows/Fonts/timesbd.ttf` |
| `oauthClient` | Client ID + Secret Google (bước 4) | |
| `telegram` | Báo tin khi xong mỗi kênh (tuỳ chọn) | `"enabled": false` |

Dùng dấu `/` trong đường dẫn. Đường dẫn tương đối tính từ thư mục app.

---

## 4. Tạo OAuth client Google (làm 1 lần)

1. Vào https://console.cloud.google.com → tạo Project (hoặc dùng project có sẵn).
2. **APIs & Services → Library** → bật **YouTube Data API v3**.
3. **OAuth consent screen**: loại *External*, điền tên app + email. Thêm các tài khoản Google của kênh vào *Test users*.
   ⚠️ **Bấm "PUBLISH APP" (In production)** — nếu để *Testing*, đăng nhập kênh **tự hết hạn sau 7 ngày**.
4. **Credentials → Create credentials → OAuth client ID** → loại **Desktop app**.
5. Chép **Client ID** và **Client secret** vào `config.json` → `oauthClient`.

> Có thể dùng chung OAuth client của máy cũ (Client ID/Secret giống nhau ở mọi máy).

---

## 5. Chạy app

- **Chạy thử:** bấm đúp `start.bat`, mở trình duyệt `http://127.0.0.1:18990`.
- **Tự chạy khi bật máy:** chuột phải `cai-tu-chay.bat` → **Run as administrator**. Tạo task `YCF-server` (tài khoản SYSTEM, chạy bù, tự khởi động lại nếu lỗi).

**Kho media nằm trên ổ ảo (`subst`)?** Tài khoản SYSTEM không thấy ổ ảo của user. Tạo file `subst.txt` cạnh `start.bat`, mỗi dòng một ổ:
```
D: C:\ai-data
```

---

## 6. Thiết lập trên giao diện web

Làm theo đúng thứ tự:

1. **Kênh & Playlist → ➕ Thêm kênh mới**: đặt mã kênh (vd `alta`) → bấm *Mở trang đăng nhập Google* → chọn đúng tài khoản kênh → *Cho phép* → trang lỗi `127.0.0.1:8737` hiện ra (**bình thường**) → copy **toàn bộ địa chỉ** trên thanh URL → dán vào ô → *Lưu*. App tự lấy tên kênh, tạo kho chữ/SEO riêng cho kênh.
2. **Kho tài nguyên → + Tạo kho**: chọn loại (hook / chuyện / outro / video shot / nhạc nền), nhập đường dẫn thư mục → *Quét lại*. Hook/chuyện/outro **thiếu `.srt` sẽ bị từ chối**.
3. **Kho chữ & SEO**: chọn kênh + kho → ô **📁 Thư mục SEO**: nhập đường dẫn thư mục SEO (chuẩn `docs/CHUAN-KHO-SEO.md`) → **Lưu** → app quét và báo số mục + lỗi từng dòng. Sửa file rồi bấm **Quét lại** (app cũng tự quét trước mỗi lần dựng). Để trống ô này thì nhập tay trên web như cũ.
4. **Kênh & Playlist → + Thêm playlist**: ID playlist YouTube, công thức (tổng phút, số truyện, hình nền, màn đen), tick kho từng loại, chọn kho chữ/SEO → *Xem trước* → *Lưu*.
5. **Chạy chuỗi**: tick playlist, sắp thứ tự → *Chạy ngay* hoặc *Lưu thành lịch mỗi ngày* (giờ Việt Nam).

Mỗi video: dựng → kiểm tra (thời lượng, fade, phụ đề) → upload **Riêng tư** → hẹn đăng phụ đề sau 6 giờ → dọn file tạm → sang kênh sau. Chỉ một kênh chạy một lúc.

---

## 7. Mở giao diện từ xa (tuỳ chọn)

Cài **Tailscale** (https://tailscale.com) trên máy chạy app và trên điện thoại/laptop, cùng một tài khoản. App tự nhận IP Tailscale (`100.x.x.x`) và mở thêm ở `http://100.x.x.x:18990`. Mở cổng trong Windows Firewall chỉ cho dải Tailscale (PowerShell admin):
```
netsh advfirewall firewall add rule name="YCF Tailscale" dir=in action=allow protocol=TCP localport=18990 remoteip=100.64.0.0/10
```
⚠️ **Không** mở cổng ra Internet — app chưa có đăng nhập.

---

## 8. Kiểm tra sau khi cài

```
node test\test-plan.mjs        (công thức — không cần dữ liệu)
node test\test-executor.mjs    (logic dựng — không cần dữ liệu)
```
Sau khi đã có kho + playlist: bấm **Lập kế hoạch** ở trang Sản xuất, rồi chạy chuỗi 1 playlist để dựng thật.

### Cập nhật

- **Cách 1 (nút bấm):** khi có bản mới, menu trái hiện **🔔 Có bản mới vX** → bấm xem nội dung → **Cập nhật**. App tự tắt, tải code mới (chỉ fast-forward), sao lưu `data\`, `secrets\`, `config.json` vào `backups\<ngày-giờ>\` (giữ 5 bản gần nhất) rồi bật lại (~30 giây). Nếu bản mới không chạy được, tự quay về bản cũ (ROLLBACK).
- **Cách 2 (bằng tay):** bấm đúp `cap-nhat.bat` trong thư mục app.
- Nhật ký: `logs\update.log`. Không cập nhật nếu có file code đã bị sửa tay trong repo.

---

## 9. Lỗi thường gặp

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

## 10. Cấu trúc thư mục

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
