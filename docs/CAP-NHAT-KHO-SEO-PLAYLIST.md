# Cập nhật: mỗi playlist một kho SEO riêng (05/10/2026)

## Thay đổi

- Trang **Kho chữ & SEO**:
  - Nút **+ Tạo kho SEO**: chọn kênh → nhập mã kho, tên, thư mục (chưa có thì app tự tạo) → **Tạo**.
  - Mỗi kho hiện dòng **"Đang dùng cho playlist: …"**; kho dùng chung cho nhiều playlist có dấu ⚠.
  - Ô chọn kho hiện kèm tên playlist đang dùng.
- **Form playlist** (thêm mới / sửa): chỉ **chọn** kho SEO đã tạo. Kho đang dùng chung với playlist khác → hiện cảnh báo vàng (không chặn lưu).
- **Nhân bản playlist**: bản sao có **kho SEO mới, TRỐNG**, mã = mã playlist mới, thư mục `seo-<mã playlist mới>` cạnh thư mục kho gốc. Chép file SEO vào thư mục đó rồi bấm **Quét lại** trước khi bật playlist.
- Xoá playlist nhân bản: kho SEO đi kèm (nếu vẫn trống, không ai dùng) được xoá theo.

Đổi 2 file code: `server/server.mjs`, `public/app.js`. **Không đổi cơ sở dữ liệu.**

## Cách thiết lập kho riêng cho playlist đang có

1. Kho chữ & SEO → chọn kênh → **+ Tạo kho SEO** (vd mã `alta-4h`, thư mục `D:\seo-library\seo-alta-4h`).
2. Chép file SEO (theo chuẩn CHUAN-KHO-SEO) vào thư mục → **Quét lại**.
3. Kênh & Playlist → **Sửa** playlist → ô *Kho chữ thumbnail + SEO* → chọn kho vừa tạo → **Lưu**.

## Cách cập nhật máy đang chạy

1. **Chọn lúc không có chuỗi đang chạy.**
2. Sao lưu: đổi tên `server\server.mjs` → `server.mjs.cu`, `public\app.js` → `app.js.cu`.
3. Lấy file mới: `git pull`, hoặc tải 2 file từ GitHub / file anh Vũ gửi, chép đè đúng chỗ.
4. **Khởi động lại app**: chạy lại `start.bat`, hoặc PowerShell admin:
   ```
   schtasks /End /TN "YCF-server"
   schtasks /Run /TN "YCF-server"
   ```
5. Trình duyệt: **Ctrl + F5**. Vào Kho chữ & SEO, thấy nút **+ Tạo kho SEO** là xong.

Lỗi thì đổi 2 file `.cu` về tên cũ và khởi động lại.
