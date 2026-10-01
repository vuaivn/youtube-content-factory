// test-archive.mjs — Lưu trữ / Khôi phục kênh, playlist, kho, mục ẩn (30/09). Chạy khi server đang chạy.
// Chỉ dùng dữ liệu THỬ (playlist nhân bản) hoặc mục vô hại; cuối bài trả mọi thứ về nguyên trạng.
const B = 'http://127.0.0.1:18990';
const api = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (r.status >= 400) throw new Error(j.error); return j; };
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  DAT   ' : '  TRUOT ') + m); };
const has = (arr, id) => arr.some(x => x.id === id);
const TP = '_test-luu-tru';
try {
  // --- playlist ---
  await api('POST', '/api/playlist/pqta-podcast/clone', { new_id: TP, new_name: 'Thử lưu trữ' });
  await api('POST', `/api/playlist/${TP}/archive`);
  ok(!has(await api('GET', '/api/channel/pqta/playlist'), TP), 'playlist lưu trữ: biến khỏi trang kênh');
  ok(has((await api('GET', '/api/archive')).playlists, TP), 'playlist hiện trong mục Lưu trữ');
  try { await api('POST', '/api/chain', { playlist_ids: [TP] }); ok(false, 'chuỗi phải từ chối playlist lưu trữ'); }
  catch (e) { ok(/lưu trữ/.test(e.message), 'chạy chuỗi với playlist lưu trữ bị từ chối'); }
  await api('POST', `/api/playlist/${TP}/restore`);
  ok(has(await api('GET', '/api/channel/pqta/playlist'), TP), 'khôi phục playlist: có lại trên trang kênh');

  // --- kênh (Khất Sĩ: không có playlist thật) + playlist đi kèm ---
  const chBefore = (await api('GET', '/api/channel')).length;
  await api('POST', '/api/channel/khatsi/archive');
  ok(!has(await api('GET', '/api/channel'), 'khatsi') && (await api('GET', '/api/channel')).length === chBefore - 1, 'kênh lưu trữ: biến khỏi danh sách kênh');
  ok(has((await api('GET', '/api/archive')).channels, 'khatsi'), 'kênh hiện trong mục Lưu trữ');
  await api('POST', '/api/channel/khatsi/restore');
  ok(has(await api('GET', '/api/channel'), 'khatsi'), 'khôi phục kênh: có lại');

  // kênh PQTA lưu trữ → playlist đi theo, khôi phục → playlist trở lại (playlist lưu trữ RIÊNG thì vẫn ở lại)
  await api('POST', `/api/playlist/${TP}/archive`);                      // lưu trữ riêng trước
  await api('POST', '/api/channel/pqta/archive');
  const ar = await api('GET', '/api/archive');
  ok(has(ar.channels, 'pqta') && !has(ar.playlists, 'pqta-podcast') && has(ar.playlists, TP), 'kênh lưu trữ: playlist đi kèm không hiện lẻ, playlist lưu trữ riêng vẫn hiện');
  try { await api('POST', `/api/playlist/${TP}/restore`); ok(false, 'phải chặn'); } catch (e) { ok(/khôi phục kênh trước/.test(e.message), 'không khôi phục playlist khi kênh còn lưu trữ'); }
  await api('POST', '/api/channel/pqta/restore');
  const pl = await api('GET', '/api/channel/pqta/playlist');
  ok(has(pl, 'pqta-podcast') && has(pl, 'pqta-tonghop-4h') && !has(pl, TP), 'khôi phục kênh: 2 playlist thật trở lại, playlist lưu trữ riêng vẫn ở Lưu trữ');

  // --- kho ---
  await api('POST', '/api/pool/tu-hu-90s/archive', {});
  ok(!has(await api('GET', '/api/pool'), 'tu-hu-90s') && has((await api('GET', '/api/archive')).pools, 'tu-hu-90s'), 'kho lưu trữ: biến khỏi trang kho, hiện ở Lưu trữ');
  await api('POST', '/api/pool/tu-hu-90s/restore');
  ok(has(await api('GET', '/api/pool'), 'tu-hu-90s'), 'khôi phục kho');
  const r = await api('POST', '/api/pool/music-main/archive', {});
  ok(r.need_confirm && r.orphan.length >= 4 && has(await api('GET', '/api/pool'), 'music-main'), `kho nhạc duy nhất: đòi xác nhận, liệt kê ${r.orphan.length} playlist, CHƯA lưu trữ`);
} finally {
  // trả nguyên trạng
  for (const u of ['/api/channel/khatsi/restore', '/api/channel/pqta/restore', '/api/pool/tu-hu-90s/restore', '/api/pool/music-main/restore']) await api('POST', u).catch(() => {});
  await api('DELETE', `/api/playlist/${TP}`).catch(() => {});
  const chs = (await api('GET', '/api/channel')).map(c => c.id).sort().join(',');
  console.log(`\n${pass} DAT / ${fail} TRUOT · kênh sau test: ${chs}`);
  process.exit(fail ? 1 : 0);
}
