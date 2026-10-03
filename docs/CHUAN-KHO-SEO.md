# Chuẩn dữ liệu kho SEO (tiêu đề · mô tả · phần kết & hashtag · tag · chữ thumbnail)

Gửi bên sản xuất nguyên liệu. Mỗi **kho SEO = một thư mục**. Bên nhận chỉ cần chép thư mục vào máy → trỏ playlist tới thư mục → **Quét lại** là dùng được.

---

## 1. Cấu trúc thư mục

```
seo-alta-4h/                  ← tên thư mục: seo-<kênh>-<playlist>, không dấu
  tieu-de.csv                 ← danh sách tiêu đề
  mo-ta/                      ← mỗi mô tả là 1 file .txt
     01-buong-bo.txt
     02-tam-an.txt
  ket-hashtag.txt             ← phần kết + CTA + hashtag (CHUNG cho mọi video)
  tag.csv                     ← danh sách tag
  chu-thumbnail.csv           ← chữ in lên ảnh thumbnail
```

- Một playlist trỏ tới **một** thư mục. Một kênh có thể có nhiều thư mục (vd video 4 giờ và podcast của cùng kênh dùng 2 thư mục riêng).
- **Mọi file lưu mã UTF-8.** Google Sheets: *Tệp → Tải xuống → CSV*. Excel: *Lưu thành → CSV UTF-8 (Comma delimited)*. Notepad: *Save As → Encoding: UTF-8*.
- File `.csv`: **dòng đầu là tên cột** đúng như bảng dưới. Nội dung có dấu phẩy thì để trong ngoặc kép `"..."` (Sheets/Excel tự làm).

## 2. `tieu-de.csv` — tiêu đề

| Cột | Bắt buộc | Ghi chú |
|---|---|---|
| `tieu_de` | ✅ | Mỗi dòng một tiêu đề |

- YouTube giới hạn **100 ký tự**.
- ⚠️ Playlist **có đánh số tập** (vd Podcast Quán Thế Âm): app tự thêm phía trước `Podcast Quán Thế Âm: Số 83 | ` → tiêu đề chỉ còn **khoảng 65 ký tự**.
- Mỗi video bốc **1 tiêu đề ít dùng nhất** (chống lặp).

```
tieu_de
Nghe Lời Phật Dạy Mỗi Đêm Ngủ Ngon Giấc
Đêm Khó Ngủ Nghe Phật Dạy Buông Bỏ Phiền Muộn
```

## 3. `mo-ta/*.txt` — mô tả

- Mỗi file `.txt` là **một mô tả**, viết thoải mái nhiều dòng, xuống dòng như bình thường. Tên file không dấu.
- Mỗi video bốc **1 mô tả ít dùng nhất**.
- **Mục lục thời gian (timeline):** app tự tạo từ các truyện trong video. Muốn đặt ở đâu thì ghi đúng chữ `{TIMELINE}` tại chỗ đó; không ghi thì app tự thêm ở cuối mô tả.
- **Độ dài:** YouTube cho tối đa 5.000 ký tự cả mô tả. Trừ 1.000 dành cho phần kết & hashtag và chỗ cho timeline (video 4 giờ ~ 800 ký tự) → **mỗi file mô tả nên ≤ 3.000 ký tự**.
- Không ghi phần kết / CTA / hashtag trong file mô tả (đã có ở mục 4).

## 4. `ket-hashtag.txt` — phần kết, CTA, hashtag

- **Một file duy nhất**, dùng **chung cho mọi video** của playlist, luôn gắn ở **cuối mô tả**.
- Gồm: lời kết, kêu gọi đăng ký / bấm chuông, link kênh/playlist, dòng hashtag.
- **Tối đa 1.000 ký tự.**
- Hashtag: đặt ở dòng cuối, cách nhau bằng dấu cách, mỗi hashtag bắt đầu bằng `#`, viết liền không dấu cách bên trong. YouTube chỉ hiện **3 hashtag đầu** phía trên tiêu đề → để 3 cái quan trọng nhất lên đầu. Tổng không quá 15 hashtag.

```
🙏 Cảm ơn bạn đã lắng nghe. Chúc bạn một đêm an lành.
🔔 Đăng ký kênh để nghe lời Phật dạy mỗi đêm: https://www.youtube.com/@anlacthienam

#loiphatday #ngungon #anlacthienam #phatphap #thien
```

## 5. `tag.csv` — tag

| Cột | Bắt buộc | Ghi chú |
|---|---|---|
| `tag` | ✅ | **Mỗi dòng MỘT tag** |

- App gộp **tất cả** tag trong file (bỏ trùng), lấy từ trên xuống đến khi đủ **khoảng 480 ký tự** → **tag quan trọng xếp lên đầu**.
- Không ghi dấu `#`.

```
tag
lời phật dạy
nghe phật pháp ngủ ngon
truyện phật giáo
```

## 6. `chu-thumbnail.csv` — chữ in lên thumbnail

| Cột | Bắt buộc | Ghi chú |
|---|---|---|
| `dong_1` | ✅ | Dòng chữ lớn thứ nhất (trắng) — **nên ≤ 22, tối đa 26 ký tự** |
| `dong_2` | nên có | Dòng chữ lớn thứ hai (vàng kem) — **nên ≤ 22, tối đa 26 ký tự** |
| `dong_phu` | không | Dòng nhỏ phía dưới. **Để trống** thì app tự ghi `<Tên kênh> • Giấc Ngủ An Yên 4 Giờ` |

- Mỗi video bốc **1 dòng ít dùng nhất**.
- Viết HOA hay thường tuỳ ý — app in đúng như nhập.

```
dong_1,dong_2,dong_phu
BUÔNG BỎ,ĐỂ AN LÒNG,
TÂM AN,NGỦ NGON,Nghe mỗi đêm
```

## 7. App làm gì khi Quét lại

| Trường hợp | App xử lý |
|---|---|
| Dòng / file mới | Thêm vào kho |
| Dòng / file bị xoá khỏi thư mục | Ngừng dùng (giữ lịch sử đã dùng để chống lặp) |
| Dòng bị sửa nội dung | Coi là mục mới |
| Vượt giới hạn ký tự, sai tên cột, file không phải UTF-8 | **Báo cụ thể file + dòng**, bỏ qua dòng đó |
| `ket-hashtag.txt` > 1.000 ký tự | Báo lỗi, không dùng |

App cũng tự quét lại trước mỗi lần dựng video, nên chỉ cần sửa file là lần sau dùng bản mới.

## 8. Bảng kiểm trước khi gửi

- [ ] Đủ 5 thứ: `tieu-de.csv`, thư mục `mo-ta/`, `ket-hashtag.txt`, `tag.csv`, `chu-thumbnail.csv`
- [ ] Mọi file lưu UTF-8, mở ra chữ có dấu đọc bình thường
- [ ] Dòng đầu file CSV đúng tên cột
- [ ] Tiêu đề ≤ 100 ký tự (≤ 65 nếu playlist đánh số tập)
- [ ] Mỗi mô tả ≤ 3.000 ký tự, không chứa phần kết/hashtag
- [ ] `ket-hashtag.txt` ≤ 1.000 ký tự
- [ ] Chữ thumbnail mỗi dòng ≤ 26 ký tự (nên ≤ 22)
- [ ] Số lượng tối thiểu nên có: 50 tiêu đề, 10 mô tả, 50 bộ chữ thumbnail (càng nhiều càng ít lặp)
