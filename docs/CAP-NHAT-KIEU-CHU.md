# Cập nhật: kiểu chữ thumbnail + kiểu phụ đề theo playlist, xoá hẳn trong Lưu trữ (08/10/2026)

## Tính năng mới

- Trang mới **🎨 Kho kiểu chữ** (menu trái): tạo / sửa / nhân bản / xoá kiểu, có nút **Xem thử** (tạo ảnh từ một video shot thật).
  - **Kiểu chữ thumbnail**: font, bố cục (dải nền dưới · chữ giữa ảnh · khung trái), màu nền + độ đậm, màu/cỡ/viền từng dòng, đổ bóng.
  - **Kiểu phụ đề**: font, cỡ, màu chữ, màu viền, độ dày viền, hộp nền mờ, chữ đậm, khoảng cách tới đáy.
  - Có sẵn 5 kiểu thumbnail (Cổ điển · Chữ lớn giữa ảnh · Khung bên trái · Thiền tối giản · Vàng nổi) và 5 kiểu phụ đề (Nâu kem · Trắng viền đen · Vàng viền đen · Hộp nền mờ · Nhỏ, ít che hình).
  - Font thư pháp (giấy phép mở OFL, có đủ dấu tiếng Việt): **Dancing Script**, **Pacifico** — nằm trong `assets/fonts/`, **chỉ dùng cho thumbnail**. Phụ đề dùng font có sẵn trên Windows.
- **Form Sửa playlist**: thêm 2 ô chọn **Kiểu chữ thumbnail** và **Kiểu phụ đề**, mỗi ô có nút **Xem thử**. Chưa chọn = **như hiện tại** (thumbnail Cổ điển, phụ đề giữ nguyên kiểu đang ra). Nhân bản playlist chép theo kiểu đã chọn.
- **Lưu trữ**: thêm nút **🗑 Xoá** (xoá hẳn) cho kênh / playlist / kho / mục đã ẩn.
  - Mọi lệnh xoá trong app phải **gõ đúng chữ `delete`** để xác nhận.
  - Xoá kho / mục: chỉ xoá khỏi app, **file trên ổ giữ nguyên**.
  - Xoá playlist: xoá cả công thức, lịch sử job và **lịch sử đã dùng** của playlist đó.
  - Xoá kênh: xoá các playlist + kho chữ/SEO của kênh; **file đăng nhập chuyển vào `secrets/_da-xoa`**, không xoá hẳn.
  - Không xoá được mục đang nằm trong chuỗi chưa chạy xong.

## File thay đổi

| File | |
|---|---|
| `server/recipe/styles.mjs` | **mới** — danh sách kiểu có sẵn, kiểm thông số, dựng chuỗi filter ffmpeg |
| `server/migrate/m6-style.mjs` | **mới** — bảng `style` + 2 cột `thumb_style_id`, `subtitle_style_id` ở playlist (tự chạy khi khởi động) |
| `server/routes-style.mjs` | **mới** — API kho kiểu chữ, xem thử, xoá hẳn |
| `server/server.mjs` | nối các phần trên |
| `server/execute/upload.mjs` | tạo thumbnail theo kiểu playlist chọn |
| `public/app.js`, `public/style.css` | giao diện |
| `assets/fonts/` | **mới** — DancingScript.ttf, Pacifico.ttf, OFL.txt |
| `test/test-style.mjs` | **mới** — kiểm thử |

**Có đổi cơ sở dữ liệu** (tự thêm khi khởi động lại, không mất dữ liệu cũ).

## Cách cập nhật máy đang chạy

1. **Chọn lúc không có chuỗi đang chạy.** Sao lưu `data\factory.db` (chép ra chỗ khác).
2. Máy có git: `git pull`. Không có git: tải ZIP từ GitHub, chép đè thư mục `server\`, `public\`, `assets\`, `test\`, `docs\` (**không** chép đè `config.json`, `data\`, `secrets\`).
3. **Khởi động lại app** (`start.bat`, hoặc PowerShell admin: `schtasks /End /TN "YCF-server"` rồi `schtasks /Run /TN "YCF-server"`).
4. Trình duyệt **Ctrl + F5** → menu trái có **🎨 Kho kiểu chữ** là xong.
5. Kiểm tra: `node test\test-style.mjs` → `16 DAT / 0 TRUOT`.

Lỗi thì chép `factory.db` đã sao lưu về, lấy lại code cũ, khởi động lại.
