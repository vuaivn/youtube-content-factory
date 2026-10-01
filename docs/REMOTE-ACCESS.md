# Nghiên cứu: mở giao diện web YCF từ xa (Internet), xử lý vẫn trên us01

> Yêu cầu anh Vũ 23:11 27/09. CHỈ NGHIÊN CỨU — chưa thực hiện.
> Hiện trạng đo thật lúc nghiên cứu: server YCF nghe `127.0.0.1:18990` (chỉ máy này).

## Phát hiện quyết định: máy đã có sẵn Tailscale

Đo thật trên us01 (không đoán):

```
tailscale status  →  tailnet vuaivn@:
100.109.80.1   us01 (máy này)
100.113.45.90  iphone14
100.111.139.7  vubentre-laptop   (online 3h trước)
100.112.215.2  us02 · 100.125.253.3 us03 · phonglamviec (offline 39 ngày)
```

iPhone và laptop của anh **đã ở trong cùng mạng riêng** với us01. Không cần cài gì thêm,
không cần mở cổng router, không cần domain.

## Phương án A — Tailscale (ĐỀ XUẤT ✅)

**Cách hoạt động:** server YCF mở thêm trên địa chỉ Tailscale của us01. Từ iPhone/laptop
(đã đăng nhập tailnet vuaivn@) gõ `http://100.109.80.1:18990` — vào thẳng giao diện,
mọi xử lý (render/upload) vẫn chạy trên us01.

**Việc phải làm khi anh duyệt (2 việc nhỏ):**
1. `server.mjs`: bind `0.0.0.0` thay vì `127.0.0.1` (1 dòng, có cờ env `YCF_BIND`).
2. Firewall Windows: mở cổng 18990 **chỉ cho dải Tailscale** `100.64.0.0/10`
   (không mở cho Internet):
   ```
   New-NetFirewallRule -DisplayName 'YCF Tailscale' -Direction Inbound -Action Allow `
     -Protocol TCP -LocalPort 18990 -RemoteAddress 100.64.0.0/10
   ```

| Tiêu chí | Đánh giá |
|---|---|
| Bảo mật | ✅ Chỉ thiết bị trong tailnet vuaivn@ vào được. WireGuard mã hoá đầu-cuối. Không lộ cổng ra Internet công cộng. |
| Chi phí | ✅ 0 đ (gói free 100 thiết bị) |
| Cài đặt | ✅ KHÔNG cài gì — đã có sẵn hết |
| Điện thoại | ✅ iphone14 đã trong tailnet |
| Rủi ro | Máy lạ muốn vào phải được mời vào tailnet (anh kiểm soát) |

**Tuỳ chọn nâng cấp miễn phí:** `tailscale serve --bg 18990` → tự có HTTPS
`https://us01.<tailnet>.ts.net`, vẫn chỉ nội bộ tailnet. Đỡ phải nhớ IP.

## Phương án B — Cloudflare Tunnel (khi cần đưa cho NGƯỜI KHÁC ngoài tailnet)

`cloudflared` tạo đường hầm ra domain công khai (vd `ycf.sound-well.org`), che IP máy,
kèm Cloudflare Access (đăng nhập email mới vào được).

- ✅ Ai có link + qua Access đều dùng được, không cần cài app
- ❌ Phải cài cloudflared + cấu hình domain + BẮT BUỘC bật Access (không thì cả Internet
  thấy giao diện — nút "Xếp hàng sản xuất" ai bấm cũng được, rất nguy hiểm)
- ❌ Thêm một dịch vụ phải sống (tunnel chết là mất truy cập)

Chỉ đáng làm nếu sau này anh muốn người ngoài (không trong tailnet) thao tác.

## Phương án C — Mở port router / DDNS (LOẠI ❌)

Lộ cổng thẳng ra Internet từ IP 93.127.141.4. App chưa có đăng nhập → ai quét port cũng
điều khiển được máy. Muốn an toàn phải tự xây auth + HTTPS + chống dò mật khẩu — nhiều
việc hơn cả A+B cộng lại. Không đáng.

## So sánh nhanh

| | A. Tailscale | B. CF Tunnel | C. Mở port |
|---|---|---|---|
| Việc phải làm | 1 dòng code + 1 rule firewall | cài đặt + domain + Access | auth tự xây + rủi ro |
| Bảo mật | mạng riêng mã hoá | phụ thuộc Access | tự chịu |
| Ai dùng được | thiết bị của anh | ai anh cho phép | cả thế giới 😱 |
| Chi phí | 0đ | 0đ (domain đã có) | 0đ |

## Đề xuất

**Làm A ngay** (2 việc nhỏ, 5 phút, đảo ngược được — xoá rule + đổi lại bind là xong).
B để dành khi có nhu cầu chia sẻ ngoài. C không bao giờ.

Lưu ý bổ sung khi làm A:
- Trang Sản xuất đã có cổng chặn (gate + duyệt kế hoạch trước khi chạy) nên bấm nhầm
  từ điện thoại cũng không render bừa — vẫn phải qua màn duyệt.
- Nên thêm 1 dòng hiển thị "đang truy cập từ xa" trên giao diện để biết nguồn thao tác.

---

## DA TRIEN KHAI (28/09/2026, anh Vu duyet phuong an A)

Trang thai: HOAT DONG. Link: http://100.109.80.1:18990 (thiet bi trong tailnet vuaivn@).

4 lop da lam (deu test that):
1. **Bind hep**: server nghe DUNG 2 dia chi 127.0.0.1 + IP Tailscale (khong 0.0.0.0).
   Tailscale len muon luc boot -> server tu do lai moi 30s toi khi bind duoc.
2. **Chong CSRF** (app chua co auth): tu choi Host/Origin la -> 403. Test: Host gia 403, Origin la 403, hop le 200.
3. **Firewall**: rule "YCF Tailscale 18990" chi cho remoteip=100.64.0.0/10 (lop phu).
4. **Autostart**: Scheduled Task "YCF-server" ONSTART, RU SYSTEM, StartWhenAvailable=True, RestartCount=3.
   Script: khoi-dong-ycf.bat (tu subst D: vi SYSTEM khong thay subst cua user; node dung duong dan tuyet doi).

Bai hoc dem 27-28/09 (de khong lap):
- 2 server chay chong 1 port -> port serve code CU. Truoc khi start: kill het listener cu, kiem 1 PID duy nhat.
- preset ultrafast phinh file 3-4 lan so voi veryfast cung CRF -> mux cuoi dung veryfast.
- +faststart ghi file LAN HAI -> can gap doi dung luong dia. Da go khoi moi buoc.
- concat filter_complex mo dong thoi N file (1836) -> ffmpeg chet. Dung concat demuxer (doc tuan tu) + re-encode.
