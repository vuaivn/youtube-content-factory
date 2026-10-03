# Chuẩn dữ liệu kho giọng đọc (Hook / Chuyện / Outro)

Áp dụng cho bên sản xuất nguyên liệu gửi về cho YouTube Content Factory.
Đạt đủ chuẩn này thì chỉ cần **chép thư mục vào máy → tạo kho trên web → bấm Quét lại** là dùng được ngay.

---

## 1. Mỗi lô = một thư mục = một kho

- **Một thư mục chỉ chứa MỘT loại**: hoặc toàn hook, hoặc toàn chuyện, hoặc toàn outro. Không trộn.
- **Một thư mục chỉ dành cho MỘT kênh** nếu nội dung có nhắc tên kênh / kêu gọi đăng ký.
- Đặt tên thư mục: `<loại>-<kênh>-<chủ đề>`, ví dụ `hook-alta-phat-day`, `chuyen-kcnq-nhan-qua-2`, `outro-pqta-niem-phat`.
- Đặt thẳng các file trong thư mục. Không đặt tên thư mục con bắt đầu bằng `_` hoặc tên `audio`, `out-final` (app bỏ qua các thư mục này).

## 2. Mỗi mục = 2 file CÙNG TÊN

| File | Bắt buộc | Ghi chú |
|---|---|---|
| `ten-muc.mp3` | ✅ | Giọng đọc. Chấp nhận `.mp3` hoặc `.wav` |
| `ten-muc.srt` | ✅ | Phụ đề khớp giọng đọc. **Thiếu `.srt` → app TỪ CHỐI, không nhập** |
| `ten-muc.json` | nên có | Phiếu thông tin (mục 6) |

**Tên file:** chữ thường, **không dấu**, nối bằng gạch ngang, không khoảng trắng, không ký tự đặc biệt.
Ví dụ đúng: `nguoi-con-cong-cha-len-nui.mp3` + `nguoi-con-cong-cha-len-nui.srt`
Ví dụ sai: `Người con cõng cha.mp3`, `chuyen 01 (final).mp3`

## 3. Chuẩn âm thanh

| Thông số | Yêu cầu |
|---|---|
| Định dạng | MP3 128 kbps trở lên (hoặc WAV) |
| Tần số mẫu | 44.100 Hz hoặc 48.000 Hz |
| Kênh | Mono hoặc stereo |
| Âm lượng | **−16 LUFS** (sai lệch ±0,5) · đỉnh thật **≤ −1,5 dBTP** |
| Lặng đầu file | 0,3 – 0,5 giây |
| Lặng cuối file | 0,3 – 1 giây (không để đuôi lặng dài) |
| Nội dung | Chỉ giọng đọc — **không chèn nhạc nền**, không tiếng ồn, không tiếng "click" |

**Thời lượng gợi ý:**
| Loại | Độ dài |
|---|---|
| Hook (mở đầu) | 3 – 6 phút |
| Chuyện | 5 – 20 phút |
| Outro (kết) | 3 – 6 phút |

## 4. Chuẩn phụ đề `.srt` — ⚠️ chỗ hay hỏng nhất

- **Mã chữ BẮT BUỘC: UTF-8.** Mở bằng Notepad → *File → Save As* → *Encoding: UTF-8*.
  Lỗi đã gặp thật: 112/402 file phụ đề hỏng mã → video in lên hình thành chữ lạ kiểu `Ngà y ngà y`, `ngÃ y rằm`. **Kiểm tra: mở file, chữ có dấu phải đọc bình thường.**
- Thời gian **khớp đúng giọng đọc của chính file `.mp3` đó**, tính từ 00:00:00 của file.
- Mỗi dòng phụ đề ≤ 2 dòng, mỗi dòng ≤ 42 ký tự.
- Không có dòng thời lượng 0 giây, không có khoảng trống giữa 2 dòng phụ đề quá 5 giây (khi đang có giọng).
- Chữ đúng chính tả, đúng thuật ngữ Phật giáo (đối chiếu với kịch bản gốc, không dùng chữ máy nhận dạng sai).
- Dòng cuối kết thúc trước khi file âm thanh hết (dòng nằm sau cuối file sẽ bị bỏ).
- **Định dạng mốc giờ đúng chuẩn:** `00:01:23,456 --> 00:01:25,789` — giờ 2 chữ số, mili-giây 3 chữ số, mỗi khối cách nhau 1 dòng trống. Sai định dạng thì dòng đó bị bỏ qua, không báo lỗi.
- Lưu ý: app **chỉ kiểm có file `.srt`**, KHÔNG tự kiểm mã UTF-8, độ to hay độ khớp — các mục đó bên sản xuất phải tự soát.

## 5. Nội dung theo loại

| Loại | Phải có | Không được có |
|---|---|---|
| **Hook** | Câu chào + giới thiệu chủ đề; câu mời đăng ký kênh **nếu** làm riêng cho kênh | Không nhắc tên truyện cụ thể (vì truyện được bốc ngẫu nhiên) |
| **Chuyện** | Trọn vẹn một câu chuyện, có mở – thân – kết | Không chào kênh, không kêu gọi đăng ký, không dẫn ngủ ở cuối |
| **Outro** | Lời kết, chúc ngủ ngon / niệm Phật; câu mời đăng ký nếu riêng kênh | Không nhắc tên truyện cụ thể |

Lý do: app tự ghép **1 hook + nhiều chuyện ngẫu nhiên + 1 outro**, nên mỗi file phải đứng độc lập, ghép kiểu nào cũng hợp.

## 6. Phiếu thông tin `.json` (nên có)

```json
{
  "loai": "chuyen",
  "kenh": "kcnq",
  "tieuDe": "Người con cõng cha lên núi",
  "thoiLuongGiay": 645.0,
  "giongDoc": "Thiện Tâm",
  "tags": ["hiếu thảo", "cha con", "nhân quả"]
}
```
Lưu file `.json` dạng UTF-8.

## 7. Cách giao lô

1. Nén cả thư mục thành `.zip` hoặc gửi thư mục Google Drive.
2. **Kèm `DANH-SACH.json`** liệt kê từng file:
```json
{ "tenLo": "chuyen-kcnq-nhan-qua-2", "soFile": 60,
  "files": [ { "ten": "nguoi-con-cong-cha-len-nui.mp3", "id": "<id Drive>", "byte": 10320384 } ] }
```
Bên nhận dựa vào `byte` để phát hiện file tải hỏng.

## 8. Bên nhận làm gì (để đối chiếu)

1. Chép thư mục vào ổ chứa kho, ví dụ `D:\story-library\chuyen-kcnq-nhan-qua-2\`.
2. Web → **Kho tài nguyên → + Tạo kho** → chọn loại → nhập đường dẫn thư mục.
3. Bấm **Quét lại** → app báo: thêm được bao nhiêu, file nào bị từ chối (thiếu `.srt`, file hỏng không đọc được thời lượng).
4. Vào playlist → tick kho mới → Lưu.

## 9. Bảng kiểm trước khi gửi (bên sản xuất tự soát)

- [ ] Mỗi `.mp3` có `.srt` cùng tên
- [ ] Tên file không dấu, không khoảng trắng
- [ ] `.srt` lưu UTF-8, mở ra chữ có dấu đọc bình thường
- [ ] Phụ đề khớp giọng (nghe thử đầu – giữa – cuối mỗi file)
- [ ] Âm lượng −16 LUFS, không có nhạc nền
- [ ] Mỗi thư mục chỉ một loại, một kênh
- [ ] Kèm `DANH-SACH.json`
