// test-seo.mjs — kho SEO từ thư mục file (02/10). Dùng DB tạm, không đụng DB thật.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ycf-seo-'));
process.env.YCF_DB = path.join(T, 'test.db');
const { run, get, all, closeDb } = await import('../server/db/db.mjs');
const { migrateSeo } = await import('../server/migrate/m5-seo.mjs');
const { syncTextPool, parseCsv } = await import('../server/recipe/seo-sync.mjs');
const { pickTexts } = await import('../server/execute/upload.mjs');
migrateSeo();
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  DAT   ' : '  TRUOT ') + m); };
const D = path.join(T, 'seo-thu'); fs.mkdirSync(path.join(D, 'mo-ta'), { recursive: true });
const w = (f, s, enc = 'utf8') => fs.writeFileSync(path.join(D, f), s, enc);
w('tieu-de.csv', '\uFEFFtieu_de\nNghe Lời Phật Dạy Mỗi Đêm\n"Tâm An, Ngủ Ngon"\n' + 'X'.repeat(120) + '\n');
w('mo-ta/01.txt', 'Mô tả một.\n{TIMELINE}\nHết.');
w('mo-ta/02.txt', 'Mô tả hai.');
w('ket-hashtag.txt', '🙏 Đăng ký kênh.\n\n#loiphatday #ngungon #anlac');
w('tag.csv', 'tag\nlời phật dạy\nngủ ngon\nlời phật dạy\n\"a, b\"\n');
w('chu-thumbnail.csv', 'dong_1,dong_2,dong_phu\nBUÔNG BỎ,ĐỂ AN LÒNG,\nTÂM AN,NGỦ NGON,Nghe mỗi đêm\n');
fs.writeFileSync(path.join(D, 'mo-ta', '03.txt'), Buffer.from([0x4d, 0xf4, 0x20, 0x74, 0x61]));   // cp1252 "Mô ta" → sai mã
run("INSERT INTO channel (id,name) VALUES ('c','Kênh Thử')");
run("INSERT INTO text_pool (id,channel_id,name,root_dir) VALUES ('tp','c','Thử',?)", D);
let r = syncTextPool('tp');
ok(r.stat.title.active === 2, 'tiêu đề: 2 hợp lệ (có dấu phẩy trong ngoặc kép), bỏ dòng 120 ký tự');
ok(r.errors.some(e => /tieu-de.csv dòng 4/.test(e)), 'báo đúng dòng tiêu đề quá dài');
ok(r.stat.description.active === 2 && r.errors.some(e => /03\.txt.*UTF-8/.test(e)), 'mô tả sai mã UTF-8 bị từ chối + báo tên file');
ok(r.stat.tags.active === 2 && r.errors.some(e => /tag.csv dòng 5/.test(e)), 'tag: bỏ trùng, chặn dòng có dấu phẩy');
ok(r.stat.thumb.active === 2 && r.stat.ending.active === 1, 'chữ thumbnail 2 + phần kết 1');
ok(parseCsv('a,b\n"x\ny",z').length === 2, 'CSV: xuống dòng trong ô ngoặc kép');
// dùng rồi xoá khỏi file → ngừng dùng; thêm lại → giữ used_count
run("UPDATE seo_item SET used_count=7 WHERE kind='title' AND content='Nghe Lời Phật Dạy Mỗi Đêm'");
w('tieu-de.csv', 'tieu_de\n"Tâm An, Ngủ Ngon"\n'); r = syncTextPool('tp');
ok(r.stat.title.off === 1 && get("SELECT status FROM seo_item WHERE content='Nghe Lời Phật Dạy Mỗi Đêm'").status === 'removed', 'dòng bị xoá khỏi file → ngừng dùng');
w('tieu-de.csv', 'tieu_de\nNghe Lời Phật Dạy Mỗi Đêm\n"Tâm An, Ngủ Ngon"\n'); r = syncTextPool('tp');
ok(get("SELECT used_count FROM seo_item WHERE content='Nghe Lời Phật Dạy Mỗi Đêm'").used_count === 7 && r.stat.title.back === 1, 'thêm lại → dùng lại, GIỮ số lần đã dùng');
// mô tả: phần kết luôn ở cuối, timeline đúng chỗ
const pl = { id: 'p', channel_id: 'c', text_pool_id: 'tp', episode_numbering: 0 };
const plan = { total_s: 3600, timeline: [{ kind: 'story', start_s: 10, end_s: 600, source: { title: 'Truyện A' } }] };
let ends = 0, tl = 0;
for (let i = 0; i < 6; i++) { const p = pickTexts(pl, plan); if (p.description.endsWith('#loiphatday #ngungon #anlac')) ends++; if (/Mô tả một\.\n.*00:00:00/s.test(p.description) && p.description.indexOf('Hết.') > p.description.indexOf('00:00:00')) tl++; run('UPDATE seo_item SET used_count=used_count+1 WHERE id=?', p.ids.description); }
ok(ends === 6, 'phần kết & hashtag luôn nằm cuối mô tả');
ok(tl >= 1, '{TIMELINE} được thay đúng chỗ');
w('mo-ta/01.txt', 'A'.repeat(3990)); syncTextPool('tp');
const big = all("SELECT id FROM seo_item WHERE kind='description' AND status='active'"); run("UPDATE seo_item SET used_count=99 WHERE kind='description' AND length(content)<3000");
const p2 = pickTexts(pl, { total_s: 3600, timeline: Array.from({ length: 40 }, (_, i) => ({ kind: 'story', start_s: i * 60, end_s: i * 60 + 50, source: { title: 'Truyện số ' + i + ' rất dài để chiếm chỗ' } })) });
ok(p2.description.length <= 4900 && p2.description.endsWith('#anlac'), `mô tả dài → cắt phần mô tả, giữ nguyên phần kết (${p2.description.length} ký tự)`);
w('ket-hashtag.txt', 'x'.repeat(1001)); r = syncTextPool('tp');
ok(r.stat.ending.active === 0 && r.errors.some(e => /ket-hashtag/.test(e)), 'phần kết > 1000 ký tự → báo lỗi, không dùng');
const nBefore = get("SELECT count(*) n FROM seo_item WHERE pool_id='tp' AND kind='title' AND status='active'").n;
fs.renameSync(path.join(D, 'tieu-de.csv'), path.join(D, 'tieu-de.bak')); r = syncTextPool('tp');
ok(get("SELECT count(*) n FROM seo_item WHERE pool_id='tp' AND kind='title' AND status='active'").n === nBefore && nBefore > 0, 'lỡ mất file tiêu đề → GIỮ NGUYÊN tiêu đề cũ, không gỡ sạch');
fs.renameSync(path.join(D, 'tieu-de.bak'), path.join(D, 'tieu-de.csv'));
run("INSERT INTO text_pool (id,channel_id,name) VALUES ('tay','c','Nhập tay')");
ok(syncTextPool('tay').skipped === true, 'kho chưa trỏ thư mục → giữ nguyên nhập tay như cũ');
console.log(`\n${pass} DAT / ${fail} TRUOT`);
closeDb(); fs.rmSync(T, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
