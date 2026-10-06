// test-tags.mjs — tag gửi YouTube luôn ≤ 500 ký tự tính như YouTube (06/10). Chạy: node test/test-tags.mjs
import { fitTags, tagsLength } from '../server/execute/upload.mjs';
import { all } from '../server/db/db.mjs';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  DAT   ' : '  TRUOT ') + m); };

// đếm chuẩn: "a b",c  → 5 + 1 + 1 = 7
ok(tagsLength(['a b', 'c']) === 7, 'đếm có ngoặc kép + dấu phẩy');
const many = Array.from({ length: 40 }, (_, i) => `nhạc thiền số ${i}`);
const f = fitTags(many); ok(tagsLength(f) <= 490 && f.length < 40, `40 tag dài → giữ ${f.length}, dài ${tagsLength(f)} ≤ 490`);
ok(!fitTags(['a<b', 'ok']).includes('a<b'), 'bỏ tag có < >');
ok(fitTags(['x', 'x', ' ', 'y']).join() === 'x,y', 'bỏ trùng và rỗng');

// file tag.csv 26 tag anh Vũ gửi 04/10
const vu = 'chuyện phật giáo,kể chuyện ngủ ngon,kể chuyện phật giáo,kể chuyện đêm khuya,lời phật dạy,lời phật dạy hay nhất,nhac thien khong quang cao,nhac thien tinh tam,nhạc 432hz,nhạc ngủ ngon,nhạc thiền,nhạc thiền dễ ngủ,nhạc thiền giảm stress,nhạc thiền ngủ ngon,nhạc thiền phật giáo,nhạc thiền tịnh tâm,phật,phật giáo,phật pháp,thiền buông thư,truyện cổ phật giáo,truyện phật giáo ru ngủ,truyện ru ngủ,video dễ ngủ,nhac thien,nhạc thiền không lời'.split(',');
console.log(`  (26 tag 04/10: đếm kiểu YouTube = ${tagsLength(vu)})`);
const fv = fitTags(vu); ok(tagsLength(fv) <= 490, `26 tag 04/10 → giữ ${fv.length}, dài ${tagsLength(fv)}`);

// kho thật trên máy này
for (const p of all("SELECT DISTINCT pool_id FROM seo_item WHERE kind='tags' AND status='active'")) {
  const rows = all("SELECT content FROM seo_item WHERE pool_id=? AND kind='tags' AND status='active'", p.pool_id);
  const cand = rows.flatMap(r => r.content.split(',').map(s => s.trim()).filter(Boolean));
  const t = fitTags(cand);
  ok(tagsLength(t) <= 500, `kho ${p.pool_id}: ${cand.length} tag thô (YouTube ${tagsLength([...new Set(cand)])}) → gửi ${t.length} tag, ${tagsLength(t)} ký tự`);
}
console.log(`\n${pass} DAT / ${fail} TRUOT`); process.exit(fail ? 1 : 0);
