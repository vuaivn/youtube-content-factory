# Cập nhật tính năng "Kho SEO từ thư mục file" cho máy đang chạy

Áp dụng cho máy đã cài YouTube Content Factory nhưng chưa có tính năng này (bản trước ngày 02/10/2026).

**Sau khi cập nhật:** trang **Kho chữ & SEO** có ô **📁 Thư mục SEO**. Trỏ tới thư mục chứa `tieu-de.csv`, `mo-ta/`, `ket-hashtag.txt`, `tag.csv`, `chu-thumbnail.csv` → app tự nạp. Mô tả video có thêm **phần kết & hashtag** ở cuối.
Dữ liệu SEO cũ nhập tay **vẫn dùng được bình thường** nếu không trỏ thư mục.

---

## Bước 1 — Chờ máy rảnh
Mở trang **Chạy chuỗi**: không có chuỗi nào đang chạy / chờ. (Lần này **phải khởi động lại app**, đang dựng mà khởi động lại sẽ mất video đang dựng.)

## Bước 2 — Sao lưu dữ liệu
Chép thư mục `data\` của app ra chỗ khác, vd `data-backup-0210\`.

## Bước 3 — Lấy code mới (chọn 1 cách)

**Cách A — máy cài bằng git:** mở cửa sổ lệnh trong thư mục app:
```
git pull
```

**Cách B — máy cài bằng ZIP:**
1. Vào https://github.com/vuaivn/youtube-content-factory → **Code → Download ZIP** → giải nén ra chỗ tạm.
2. Chép **đè** các thư mục/file sau vào thư mục app: `server\` · `public\` · `tools\` · `test\` · `docs\` · `CAI-DAT.md` · `.gitignore`
3. **KHÔNG** chép đè / xoá: `config.json`, `data\`, `secrets\`, `logs\`, `captions\`.

## Bước 4 — Khởi động lại app
- Nếu cài tự chạy (task `YCF-server`): mở PowerShell **quyền admin**:
  ```
  schtasks /End /TN "YCF-server"
  schtasks /Run /TN "YCF-server"
  ```
- Nếu chạy tay: đóng cửa sổ `start.bat` đang chạy rồi bấm đúp `start.bat` lại.

Lúc khởi động app tự thêm cột mới vào cơ sở dữ liệu — không cần làm gì thêm.

## Bước 5 — Kiểm tra
Mở trình duyệt → **Ctrl + F5** → trang **Kho chữ & SEO** phải thấy ô **📁 Thư mục SEO** và tab **Phần kết & hashtag**.

## Bước 6 — (Tuỳ chọn) Chuyển kho SEO đang có sang dạng file
Xuất dữ liệu SEO hiện có ra thư mục theo đúng chuẩn, rồi trỏ luôn kho tới thư mục đó (số lần đã dùng **được giữ nguyên**, không lặp tiêu đề cũ). Chạy **khi app đang tắt** (giữa Bước 3 và Bước 4) hoặc ngay sau khi tắt app:
```
node tools\export-seo.mjs D:\seo-library --link
```
Mỗi kho ra một thư mục `D:\seo-library\seo-<kho>\`. Sau đó thêm file `ket-hashtag.txt` (phần kết + CTA + hashtag, ≤ 1.000 ký tự) vào từng thư mục rồi bấm **Quét lại** trên web.

Hoặc làm tay: chuẩn bị thư mục theo `docs\CHUAN-KHO-SEO.md` → trang Kho chữ & SEO → nhập đường dẫn → **Lưu**.

## Lỗi thường gặp
| Triệu chứng | Cách xử lý |
|---|---|
| Không thấy ô Thư mục SEO | Chưa khởi động lại app, hoặc trình duyệt còn bản cũ → Ctrl + F5 |
| "Thư mục không tồn tại" | Sai đường dẫn; ổ ảo `subst` thì khai trong `subst.txt` (xem CAI-DAT.md) |
| Báo "không phải UTF-8" | Mở file, lưu lại: Excel → *CSV UTF-8*; Notepad → *Encoding UTF-8* |
| Báo "thiếu file — giữ nguyên dữ liệu cũ" | Thiếu file trong thư mục; app không xoá dữ liệu cũ của loại đó, bổ sung file rồi Quét lại |
| Muốn quay lại bản cũ | Tắt app, chép lại `data-backup-0210\` thành `data\` và code bản cũ |
