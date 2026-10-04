# Cập nhật: tên truyện trong mục lục lấy từ phiếu `.json` (04/10/2026)

## Lỗi được sửa

Mục lục thời gian trong mô tả video hiện **tên file** (`co-giao-va-loi-khen-dung-luc--thien-tam`) thay vì tên truyện. Nguyên nhân: khi bấm **Quét lại**, app lấy tên file làm tiêu đề và bỏ qua phiếu `.json` nằm cạnh file mp3.

Sau cập nhật:
- Quét kho → tiêu đề lấy từ trường `tieuDe` (hoặc `title`) trong phiếu `.json` cùng tên.
- Truyện **đã nhập** mà tiêu đề còn là tên file → lần Quét lại tới tự sửa thành tên đúng.
- Tiêu đề anh đã **tự sửa tay** → giữ nguyên, không ghi đè.
- Không có phiếu → vẫn dùng tên file như cũ.

Chỉ đổi 1 file code: `server/recipe/pool-sync.mjs`. **Không đổi cơ sở dữ liệu.**

## Cách cập nhật máy đang chạy

1. **Chọn lúc không có chuỗi đang chạy** (trang *Chạy chuỗi* không có chuỗi "đang chạy").
2. Sao lưu: đổi tên `server\recipe\pool-sync.mjs` → `pool-sync.mjs.cu`.
3. Lấy file mới:
   - Có git: `git pull`
   - Không git: tải `server/recipe/pool-sync.mjs` từ GitHub (hoặc file anh Vũ gửi), chép vào `server\recipe\`.
4. **Khởi động lại app**: chạy lại `start.bat`, hoặc (nếu cài tự chạy) mở PowerShell admin:
   ```
   schtasks /End /TN "YCF-server"
   schtasks /Run /TN "YCF-server"
   ```
5. Vào **Kho tài nguyên** → bấm **Quét lại** ở **từng kho hook / chuyện / outro**. Thông báo có thêm dòng "sửa tên … mục".
6. Kiểm tra: mở một kho chuyện → cột tên phải là tiếng Việt có dấu.

Lỗi thì đổi `pool-sync.mjs.cu` về tên cũ và khởi động lại app.

## Video đã đăng

Mô tả video đã upload không tự sửa — vào YouTube Studio sửa tay mục lục (thay tên file bằng tên truyện).
