// test-api.mjs — thử nóng API trên server đang chạy + DB thật (chỉ đọc + ghi tạm rồi dọn).
const B = 'http://127.0.0.1:18990';
let fail = 0, n = 0;
async function ca(name, fn) { n++; try { await fn(); console.log('  DAT   ' + name); } catch (e) { fail++; console.log('  TRUOT ' + name + ' -> ' + e.message); } }
async function api(method, p, body) {
  const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(p + ' → ' + r.status + ' ' + (j.error ?? ''));
  return j;
}
const that = (c, m) => { if (!c) throw new Error(m); };

// ===== ĐỌC =====
await ca('GET /api/channel: 5 kênh, PQTA xuất hiện MỘT lần', async () => {
  const ch = await api('GET', '/api/channel');
  that(ch.length === 5, '5 kênh, có ' + ch.length);
  const pqta = ch.filter(c => c.name.includes('Quán Thế Âm'));
  that(pqta.length === 1, 'PQTA phải 1 lần, có ' + pqta.length);
  that(pqta[0].playlist_count === 2, 'PQTA phải 2 playlist, có ' + pqta[0].playlist_count);
});
await ca('GET playlist chi tiết: đủ recipe + pools kèm số đếm', async () => {
  const pl = await api('GET', '/api/playlist/pqta-podcast');
  that(pl.recipe && pl.recipe.fade_out_of_body_s === 120, 'recipe fade 120');
  that(Array.isArray(pl.pools) && pl.pools.length > 0, 'có pools');
  const shot = pl.pools.find(p => p.kind === 'shot');
  that(shot && shot.asset_count > 0 && typeof shot.unused_count === 'number', 'pool shot có asset_count + unused_count');
});
await ca('GET /api/pool: 27+ kho kèm đếm', async () => {
  const pools = await api('GET', '/api/pool');
  that(pools.length >= 27, '>=27 kho, có ' + pools.length);
  const b = pools.find(p => p.id === 'buddhist');
  that(b && b.asset_count === 40, 'kho buddhist 40 mp3 (đã tách 102 jataka), có ' + (b && b.asset_count));
});
await ca('GET asset trong kho + lọc', async () => {
  const a = await api('GET', '/api/pool/buddhist/asset');
  that(a.length === 40, '40 asset');
  that(a[0].has_subtitle === 1, 'giọng đọc phải có phụ đề');
});
await ca('GET chữ thumbnail theo pool', async () => {
  const t = await api('GET', '/api/textpool/alta/thumbnail-text');
  that(t.length === 100, 'alta 100 dòng chữ, có ' + t.length);
});
await ca('GET SEO title alta: 200, có đánh dấu đã dùng', async () => {
  const t = await api('GET', '/api/textpool/alta/seo?kind=title');
  that(t.length === 200, '200 title');
  // các title đã dùng nằm CUỐI danh sách (ORDER BY used_count)
  that(t[t.length - 1].used_count >= t[0].used_count, 'sắp xếp ưu tiên chưa dùng');
});

// ===== KẾ HOẠCH (N2 — trái tim app) =====
await ca('POST /api/playlist/pqta-podcast/plan: sinh kế hoạch thật từ DB', async () => {
  const r = await api('POST', '/api/playlist/pqta-podcast/plan', { seed: 12345 });
  that(r.ok === true, 'phải ok: ' + JSON.stringify(r.gate?.errors ?? r.errors ?? r));
  that(r.plan.fades && r.plan.compose.music_volume_expr === undefined, 'plan có fades (expr sinh ở executor)');
  that(r.plan.picked.stories.length >= 1, 'có truyện');
  that(r.plan.total_s > 0, 'tổng > 0');
});
await ca('plan cùng seed → tái lập y hệt', async () => {
  const a = await api('POST', '/api/playlist/pqta-podcast/plan', { seed: 777 });
  const b = await api('POST', '/api/playlist/pqta-podcast/plan', { seed: 777 });
  that(JSON.stringify(a.plan.picked) === JSON.stringify(b.plan.picked), 'phải y hệt');
});

// ===== GHI (tạo tạm → sửa → xoá, có lịch sử) =====
await ca('CRUD playlist: clone → sửa → xoá', async () => {
  await api('POST', '/api/playlist/pqta-podcast/clone', { new_id: '_test-clone', new_name: 'Thử nghiệm' });
  const pl = await api('GET', '/api/playlist/_test-clone');
  that(pl.enabled === 0, 'bản sao phải tắt mặc định');
  that(pl.pools.length > 0, 'bản sao mang theo pools');
  await api('PUT', '/api/playlist/_test-clone', { name: 'Đã sửa' });
  const pl2 = await api('GET', '/api/playlist/_test-clone');
  that(pl2.name === 'Đã sửa', 'sửa tên');
  const d = await api('DELETE', '/api/playlist/_test-clone');
  that(d.deleted === true, 'xoá');
});
await ca('CRUD chữ thumbnail: thêm → sửa → ẩn', async () => {
  const t = await api('POST', '/api/textpool/alta/thumbnail-text', { line1: '_THU NGHIEM', line2: 'XOA NGAY' });
  await api('PUT', '/api/thumbnail-text/' + t.id, { line1: '_DA SUA' });
  const d = await api('DELETE', '/api/thumbnail-text/' + t.id);
  that(d.removed === true, 'ẩn');
  const list = await api('GET', '/api/textpool/alta/thumbnail-text');
  that(list.length === 100, 'về lại 100 (dòng thử bị ẩn)');
});
await ca('DELETE asset = ẩn, KHÔNG đụng file gốc', async () => {
  const a = await api('GET', '/api/pool/buddhist/asset');
  const one = a[0];
  await api('DELETE', '/api/asset/' + one.id);
  const after = await api('GET', '/api/pool/buddhist/asset');
  that(after.length === 39, 'còn 39 active');
  const fs = await import('node:fs');
  that(fs.existsSync(one.file_path), 'FILE GỐC PHẢI CÒN: ' + one.file_path);
  await api('PUT', '/api/asset/' + one.id, { status: 'active' }); // khôi phục
  const back = await api('GET', '/api/pool/buddhist/asset');
  that(back.length === 40, 'khôi phục về 40');
});
await ca('POST /api/job chặn playlist không tồn tại (không tạo chuỗi thật)', async () => {
  // B3 (30/09): /api/job giờ tạo CHUỖI THẬT (dựng + upload) — test tuyệt đối không gọi với playlist thật.
  try { await api('POST', '/api/job', { playlist_id: '_khong-ton-tai' }); throw new Error('phải bị chặn'); }
  catch (e) { that(/Không có playlist/.test(e.message), 'lỗi phải báo không có playlist: ' + e.message); }
});

console.log(`\n${n - fail}/${n} ca DAT` + (fail ? '' : ' — API CHUAN TREN DB THAT.'));
process.exit(fail ? 1 : 0);
