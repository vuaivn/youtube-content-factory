# SPEC nguyên liệu VOICE (hook / chuyện / outro) cho YouTube Content Factory

> Dùng cho 3 loại kho giọng đọc: **hook** (mở đầu), **chuyện** (nội dung chính), **outro** (kết).
> Cả 3 loại CÙNG định dạng dưới đây. Khác nhau chỉ là vai trò trong video, không khác format.
> Giao hàng: mỗi kho = **1 thư mục**. Thả thư mục vào máy → trong app bấm *Tạo kho* trỏ tới thư mục → *Quét lại* là dùng được.

---

## 1. MỖI MỤC = 2 FILE CÙNG TÊN (bắt buộc)

| File | Đuôi cho phép | Bắt buộc |
|---|---|---|
| Âm thanh giọng đọc | **.mp3** (khuyên dùng) hoặc **.wav** | ✅ |
| Phụ đề | **.srt** — CHỈ .srt | ✅ BẮT BUỘC |

**Hai file phải TRÙNG TÊN gốc, chỉ khác đuôi.** Ví dụ đúng:
```
chuyen-nhan-qua-001.mp3
chuyen-nhan-qua-001.srt
```
→ Thiếu .srt đi kèm → app **TỪ CHỐI** file đó khi quét (không nhận vào kho).

> ⚠️ **PHẢI là `.srt`, KHÔNG dùng `.ass`.** File .ass qua được bước quét nhưng sẽ làm **chết bước dựng video** (app chỉ đọc .srt cùng tên khi ghép phụ đề). Đây là bẫy ngầm — nhấn mạnh với bên sản xuất.
> ⚠️ File .srt phải có sẵn **ngay lúc quét**. Nếu giao .srt trễ sau khi đã quét → phải *Quét lại* mới nhận.

---

## 2. CHUẨN FILE PHỤ ĐỀ .srt (quan trọng nhất)

- **Định dạng SRT chuẩn**: số thứ tự → dòng thời gian → nội dung → dòng trống, ví dụ:
```
1
00:00:00,000 --> 00:00:03,400
Đêm đã khuya, xin mời bạn lắng nghe...

2
00:00:03,400 --> 00:00:07,800
câu chuyện nhân quả sau đây.
```
- **Định dạng mốc thời gian PHẢI đúng**: `HH:MM:SS,mmm` — giờ 2 chữ số (bắt buộc có, kể cả `00`), mili-giây đúng 3 chữ số. Dùng dấu phẩy `,` (dấu chấm `.` cũng chịu được). Ví dụ đúng: `00:01:05,250`. **Sai** (bị bỏ qua âm thầm): `1:05,250` / `01:05,25` / `00:01:05,2`. Nếu mọi cue sai định dạng → dựng lỗi "Không gộp được cue nào".
- **Mốc thời gian tính TỪ 0** cho CHÍNH file đó (mỗi clip bắt đầu lại 00:00:00). App tự cộng offset khi ghép nhiều đoạn — bên sản xuất KHÔNG cần tự cộng dồn.
- **KHÔNG để phụ đề dài hơn audio**: cue cuối phải kết thúc **≤ độ dài file âm thanh**. Cue bắt đầu sau khi audio đã hết sẽ bị bỏ (mất chữ âm thầm) — lỗi hay gặp với pipeline TTS đệm thêm đuôi.
- **Mã hoá UTF-8** (có dấu tiếng Việt). Chịu được BOM/CRLF. **TUYỆT ĐỐI KHÔNG UTF-16** (sẽ hỏng). Mở bằng Notepad lưu "UTF-8" là chuẩn.
- Phụ đề này vừa được **burn cứng lên video**, vừa **upload làm caption track** → chất lượng chữ + timing phải chuẩn.

---

## 3. CHUẨN FILE ÂM THANH

- Giọng đọc rõ, đã mix hoàn chỉnh (app KHÔNG xử lý hậu kỳ giọng).
- ffprobe phải **đọc được thời lượng > 0** → file hỏng/0 giây sẽ bị từ chối.
- **Sample rate / số kênh: không bắt buộc đồng nhất.** App tự chuẩn hoá đầu ra về 48000 Hz stereo khi dựng, và ffmpeg tự resample khi ghép — đã test file 48kHz-stereo + 44.1kHz-mono ghép chung vẫn chạy tốt. mp3/wav thường đều dùng được. (Nếu muốn gọn nhất thì 48kHz là hợp với output, nhưng không bắt buộc.)
- Thời lượng gợi ý theo vai trò:
  - **hook**: ngắn (~vài chục giây – 1-2 phút)
  - **chuyện**: dài (nội dung chính — app ghép nhiều chuyện cho đủ tổng thời lượng video)
  - **outro**: ngắn (lời kết/kêu gọi)

---

## 4. CẤU TRÚC THƯ MỤC GIAO HÀNG

- **Một kho = một thư mục.** Cứ bỏ các cặp `.mp3 + .srt` vào trong đó là được.
- **Được chia thư mục con thoải mái** (ví dụ theo tập/phần) — hệ thống quét vào cả thư mục con nên file nằm ở đâu bên trong cũng gom được. Không bắt buộc phải để phẳng.
- **Chỉ cần tránh 3 kiểu TÊN thư mục con sau** (hệ thống dùng riêng cho file tạm, sẽ không đọc file bên trong chúng):
  1. Tên bắt đầu bằng dấu gạch dưới `_` (vd `_nhap`, `_backup`)
  2. Thư mục tên đúng là `audio`
  3. Thư mục tên đúng là `out-final`

  → Đặt tên con bình thường như `tap-01`, `phan-2`, `chuong-3`… là ổn.
- **Tên file không được trùng nhau trong cùng một kho** (vì phụ đề ghép theo tên file).

Ví dụ ĐÚNG:
```
kho-chuyen-nhan-qua\
├── nhan-qua-001.mp3          ✅
├── nhan-qua-001.srt          ✅
├── tap-02\                   ✅ thư mục con tên thường → OK
│   ├── nhan-qua-050.mp3      ✅
│   └── nhan-qua-050.srt      ✅
├── audio\                    ❌ KHÔNG đặt tên này — file bên trong bị bỏ qua
└── _nhap\                    ❌ KHÔNG đặt tên bắt đầu bằng _
```

---

## 5. CHECKLIST TRƯỚC KHI GIAO (bên sản xuất tự soát)

- [ ] Mỗi .mp3/.wav có đúng 1 file **.srt** (KHÔNG .ass) **cùng tên** bên cạnh.
- [ ] .srt mở bằng Notepad thấy dấu tiếng Việt đúng, lưu **UTF-8** (KHÔNG UTF-16).
- [ ] Mốc thời gian đúng dạng `HH:MM:SS,mmm` (giờ 2 số, ms 3 số), bắt đầu từ 00:00:00.
- [ ] Cue cuối kết thúc ≤ độ dài audio (phụ đề không dài hơn giọng).
- [ ] Audio phát được, không 0 giây, không hỏng.
- [ ] Không để file trong thư mục tên `audio` / `out-final` / bắt đầu bằng `_`.
- [ ] Tên file không trùng nhau trong cùng kho.

> Giao đúng checklist này → thả thư mục vào máy, *Quét lại*, app nhận 100%, không file nào bị từ chối.
