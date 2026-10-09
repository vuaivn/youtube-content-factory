// test-style.mjs — kiểu chữ thumbnail/phụ đề + xoá hẳn (08/10/2026). Chạy khi server đang chạy.
// Kiểu "Cổ điển" / "Nâu kem" phải ra ĐÚNG chuỗi cũ; dữ liệu thử được dọn sạch cuối bài.
import { thumbVf, subtitleForceStyle, CLASSIC_THUMB, BUILTIN, validateParams } from '../server/recipe/styles.mjs';
import { config } from '../server/config.mjs';
const B = `http://127.0.0.1:${config.port}`;
const api = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (r.status >= 400) throw new Error(j.error); return j; };
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  DAT   ' : '  TRUOT ') + m); };

// 1) chuỗi filter giống hệt bản cũ
const font = config.thumbnailFont.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
const old = ['crop=iw-120:ih-80:0:0', 'scale=1280:720', 'drawbox=x=0:y=380:w=1280:h=340:color=black@0.55:t=fill',
  `drawtext=fontfile='${font}':text='A':fontcolor=white:fontsize=88:x=(w-text_w)/2:y=430:borderw=3:bordercolor=black@0.7`,
  `drawtext=fontfile='${font}':text='B':fontcolor=#F5E5C0:fontsize=88:x=(w-text_w)/2:y=530:borderw=3:bordercolor=black@0.7`,
  `drawtext=fontfile='${font}':text='C':fontcolor=#EEDDBB:fontsize=32:x=(w-text_w)/2:y=650:borderw=2:bordercolor=black@0.6`].join(',');
ok(thumbVf(CLASSIC_THUMB, { line1: 'A', line2: 'B', sub_line: 'C' }) === old, 'kiểu Cổ điển = đúng chuỗi thumbnail cũ');
ok(subtitleForceStyle(BUILTIN.find(b => b[0] === 'sub-nau-kem')[3]) ===
  'FontName=Arial,FontSize=16,PrimaryColour=&H00223A5A,OutlineColour=&H00DDECF3,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=60', 'kiểu Nâu kem = đúng chuỗi mặc định của bộ dựng');
let bad = 0; for (const x of ["red:x", "#12'", 'white@1']) { try { validateParams('thumb', { ...CLASSIC_THUMB, colors: [x, 'white', 'white'] }); } catch { bad++; } }
ok(bad === 3, 'chặn màu có ký tự lạ (chống vỡ filter ffmpeg)');

let sid = null; const TP = '_test-style-del';
try {
  // 2) tạo / sửa / xem thử
  const r = await api('GET', '/api/style');
  ok(r.styles.length >= 10 && r.options.thumb_fonts.some(f => f.id === 'pacifico'), `có ${r.styles.length} kiểu + font thư pháp`);
  sid = (await api('POST', '/api/style', { kind: 'subtitle', name: 'Thử', params: { font: 'Tahoma', size: 20, primary: '#FFFF00', outline_color: '#000000', outline: 2, margin_v: 50 } })).id;
  ok(!!sid, 'tạo kiểu phụ đề mới');
  const pv = await api('POST', '/api/style/preview', { kind: 'thumb', params: BUILTIN.find(b => b[0] === 'thumb-vang-noi')[3], playlist_id: 'alta-sleep-4h' });
  ok(pv.image?.startsWith('data:image/jpeg;base64,') && pv.image.length > 20000, 'xem thử thumbnail thư pháp (Pacifico) ra ảnh');
  const pv2 = await api('POST', '/api/style/preview', { kind: 'subtitle', params: { font: 'Tahoma', size: 20, primary: '#FFFF00', outline_color: '#000000', outline: 2, margin_v: 50 } });
  ok(pv2.image?.length > 20000, 'xem thử phụ đề ra ảnh');

  // 3) playlist chọn kiểu → chuỗi phụ đề bộ dựng dùng được ghi đúng; bỏ chọn → về như cũ
  await api('POST', '/api/playlist/pqta-podcast/clone', { new_id: TP, new_name: 'Thử kiểu' });
  await api('PUT', `/api/playlist/${TP}/config`, { fields: { subtitle_style_id: sid, thumb_style_id: 'thumb-thien' } });
  let pl = await api('GET', `/api/playlist/${TP}`);
  ok((pl.subtitle_style ?? pl.playlist?.subtitle_style ?? '').startsWith('FontName=Tahoma,FontSize=20'), 'chọn kiểu phụ đề → chuỗi phụ đề của playlist cập nhật');
  await api('PUT', `/api/style/${sid}`, { name: 'Thử', params: { font: 'Tahoma', size: 24, primary: '#FFFF00', outline_color: '#000000', outline: 2, margin_v: 50 } });
  pl = await api('GET', `/api/playlist/${TP}`);
  ok((pl.subtitle_style ?? pl.playlist?.subtitle_style ?? '').includes('FontSize=24'), 'sửa kiểu → playlist đang dùng tự cập nhật');
  try { await api('POST', `/api/style/${sid}/delete`, { confirm: 'delete' }); ok(false, 'phải chặn xoá kiểu đang dùng'); } catch (e) { ok(/đang dùng/.test(e.message), 'chặn xoá kiểu đang dùng'); }
  await api('PUT', `/api/playlist/${TP}/config`, { fields: { subtitle_style_id: null } });
  pl = await api('GET', `/api/playlist/${TP}`);
  ok((pl.subtitle_style ?? pl.playlist?.subtitle_style) === 'brown-cream', 'bỏ chọn → về đúng giá trị cũ');

  // 4) xoá: bắt gõ "delete", chỉ xoá mục đã lưu trữ
  try { await api('POST', `/api/archive/playlist/${TP}/delete`, { confirm: 'delete' }); ok(false, 'phải chặn'); } catch (e) { ok(/đã lưu trữ/.test(e.message), 'không xoá playlist chưa lưu trữ'); }
  await api('POST', `/api/playlist/${TP}/archive`);
  try { await api('POST', `/api/archive/playlist/${TP}/delete`, { confirm: 'xoa' }); ok(false, 'phải chặn'); } catch (e) { ok(/delete/.test(e.message), 'gõ sai chữ "delete" → không xoá'); }
  ok((await api('POST', `/api/archive/playlist/${TP}/delete`, { confirm: 'delete' })).deleted, 'gõ "delete" → xoá hẳn playlist đã lưu trữ');
  ok(!(await api('GET', '/api/archive')).playlists.some(p => p.id === TP), 'playlist đã biến khỏi mục Lưu trữ');
  ok((await api('POST', `/api/style/${sid}/delete`, { confirm: 'delete' })).deleted, 'xoá kiểu không ai dùng'); sid = null;
} finally {
  if (sid) await api('PUT', `/api/playlist/${TP}/config`, { fields: { subtitle_style_id: null, thumb_style_id: null } }).catch(() => {});
  await api('DELETE', `/api/playlist/${TP}`).catch(() => {});
  if (sid) await api('POST', `/api/style/${sid}/delete`, { confirm: 'delete' }).catch(() => {});
  console.log(`\n${pass} DAT / ${fail} TRUOT`);
  process.exit(fail ? 1 : 0);
}
