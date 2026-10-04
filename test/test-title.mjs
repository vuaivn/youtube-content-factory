// test-title.mjs — tiêu đề truyện lấy từ phiếu .json khi quét kho (04/10). DB tạm, file tạm, không đụng DB thật.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ycf-title-'));
process.env.YCF_DB = path.join(T, 't.db');
const { run, get } = await import('../server/db/db.mjs');
const { syncPool, readSidecar } = await import('../server/recipe/pool-sync.mjs');
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  DAT   ' : '  TRUOT ') + m); };
const dir = path.join(T, 'kho'); fs.mkdirSync(dir);
const mp3 = fs.readdirSync('D:/story-library/nhan-qua/narrations').find(f => f.endsWith('.mp3'));
const src = 'D:/story-library/nhan-qua/narrations/' + mp3;
const mk = (stem, json, jsonName) => {
  fs.copyFileSync(src, path.join(dir, stem + '.mp3'));
  fs.writeFileSync(path.join(dir, stem + '.srt'), '1\n00:00:00,000 --> 00:00:01,000\nx\n');
  if (json) fs.writeFileSync(path.join(dir, (jsonName || stem) + '.json'), JSON.stringify(json));
};
mk('a-chuyen--thien-tam', { tieuDe: 'Chuyện A có dấu' });
mk('b-chuyen--thien-tam', { title: 'Chuyện B (title)' }, 'b-chuyen');      // phiếu gốc không hậu tố giọng
mk('c-chuyen--thien-tam', null);                                             // không phiếu
fs.writeFileSync(path.join(dir, 'c-chuyen--thien-tam.words.json'), JSON.stringify({ tieuDe: 'SAI' }));
run("INSERT INTO asset_pool (id,kind,name,root_dir) VALUES ('k','story','K',?)", dir);
const r1 = syncPool('k');
const t = n => get('SELECT title FROM asset WHERE file_path=?', path.join(dir, n + '.mp3'))?.title;
ok(r1.added === 3, `quét lần đầu thêm 3 (thêm ${r1.added})`);
ok(t('a-chuyen--thien-tam') === 'Chuyện A có dấu', 'lấy tieuDe từ phiếu cùng tên');
ok(t('b-chuyen--thien-tam') === 'Chuyện B (title)', 'phiếu không hậu tố giọng + trường title');
ok(t('c-chuyen--thien-tam') === 'c-chuyen--thien-tam', 'không phiếu → tên file; KHÔNG đọc .words.json');
ok(!!get("SELECT sidecar_json FROM asset WHERE title='Chuyện A có dấu'").sidecar_json, 'lưu phiếu vào sidecar_json');
// dữ liệu cũ: tiêu đề đang là tên file → quét lại sửa
run("UPDATE asset SET title='a-chuyen--thien-tam' WHERE title='Chuyện A có dấu'");
run("UPDATE asset SET title='Tên anh tự sửa' WHERE title='Chuyện B (title)'");
const r2 = syncPool('k');
ok(t('a-chuyen--thien-tam') === 'Chuyện A có dấu' && r2.retitled === 1, `quét lại sửa tiêu đề đang là tên file (retitled ${r2.retitled})`);
ok(t('b-chuyen--thien-tam') === 'Tên anh tự sửa', 'tiêu đề sửa tay KHÔNG bị ghi đè');
ok(r2.added === 0, 'quét lại không thêm trùng');
fs.writeFileSync(path.join(dir, 'c-chuyen--thien-tam.json'), '{hỏng');
ok(readSidecar(path.join(dir, 'c-chuyen--thien-tam.mp3')).title === null, 'phiếu hỏng → bỏ qua, không lỗi');
console.log(`\n${pass} DAT / ${fail} TRUOT`);
try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
