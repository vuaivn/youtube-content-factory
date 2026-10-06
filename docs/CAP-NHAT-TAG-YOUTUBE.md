# Cập nhật: tag YouTube đúng giới hạn 500 + 2 sửa lỗi máy mới (06/10/2026)

## Lỗi đã sửa

| File | Sửa |
|---|---|
| `server/execute/upload.mjs` | Đếm tag **đúng cách YouTube**: tag có dấu cách bị bọc `"..."` → +2 ký tự; tối đa 490. Bỏ `<` `>` khỏi tiêu đề, mô tả, tag. Trước đây đếm thiếu → kho nhiều tag bị YouTube trả lỗi 400 *"invalid video keywords"* |
| `server/recipe/seo-sync.mjs` | Khi **Quét lại** kho SEO: cảnh báo nếu tổng tag (tính kiểu YouTube) > 500, hoặc tag có `<` `>` |
| `server/execute/oauth.mjs` | Tự tạo thư mục `secrets` trước khi lưu file đăng nhập (máy mới không còn lỗi ENOENT) |
| `server/recipe/pool-sync.mjs` | Kho nhạc nhận thêm file `.aac` |

Kho có quá nhiều tag vẫn upload được: app lấy tag từ trên xuống đến khi đủ ~490 ký tự, tag nào không vừa thì bỏ qua → **xếp tag quan trọng lên đầu `tag.csv`**.

## Cách cập nhật máy đang chạy

1. **Chọn lúc không có chuỗi đang chạy.**
2. Máy **có git**: `git pull` (nếu máy đã tự sửa tay `oauth.mjs` / `pool-sync.mjs` thì trước đó chạy `git checkout -- server/execute/oauth.mjs server/recipe/pool-sync.mjs` — bản trên git đã gồm 2 sửa đó).
   Máy **không có git**: sao lưu 4 file trên (đổi đuôi `.cu`), chép đè 4 file mới từ GitHub / file anh Vũ gửi.
3. **Khởi động lại app** (`start.bat`, hoặc PowerShell admin: `schtasks /End /TN "YCF-server"` rồi `schtasks /Run /TN "YCF-server"`).
4. Kiểm tra: `node test\test-tags.mjs` → mọi dòng **DAT**, mỗi kho dòng cuối ≤ 490 ký tự.
5. Kho chữ & SEO → **Quét lại** từng kho → nếu có cảnh báo tag > 500 thì rút gọn `tag.csv` (không bắt buộc).
6. Chạy lại chuỗi cho các playlist đã lỗi upload.

Lỗi thì đổi các file `.cu` về tên cũ rồi khởi động lại.
