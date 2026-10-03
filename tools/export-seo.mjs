// export-seo.mjs — xuất kho chữ/SEO đang có trong DB ra thư mục file theo chuẩn CHUAN-KHO-SEO.md (02/10).
// node tools/export-seo.mjs <thư-mục-gốc> [--link]   (--link: trỏ luôn kho tới thư mục vừa xuất + quét)
// Nội dung giữ nguyên → khi quét lại, app nhận ra mục cũ, GIỮ số lần đã dùng (không lặp tiêu đề cũ).
import fs from 'node:fs';
import path from 'node:path';
const { all, run } = await import('../server/db/db.mjs');
const { migrateSeo } = await import('../server/migrate/m5-seo.mjs');
const { syncTextPool } = await import('../server/recipe/seo-sync.mjs');
migrateSeo();
const root = process.argv[2]; if (!root) { console.error('usage: node tools/export-seo.mjs <thu-muc> [--link]'); process.exit(2); }
const link = process.argv.includes('--link');
const csvCell = s => /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
const W = (f, s) => fs.writeFileSync(f, '\uFEFF' + s, 'utf8');   // BOM để Excel mở đúng tiếng Việt
for (const tp of all('SELECT * FROM text_pool')) {
  const dir = path.join(root, 'seo-' + tp.id); fs.mkdirSync(path.join(dir, 'mo-ta'), { recursive: true });
  const seo = k => all("SELECT content FROM seo_item WHERE pool_id=? AND kind=? AND status='active' ORDER BY id", tp.id, k).map(r => r.content);
  W(path.join(dir, 'tieu-de.csv'), 'tieu_de\n' + seo('title').map(csvCell).join('\n') + '\n');
  const md = seo('description'); md.forEach((d, i) => W(path.join(dir, 'mo-ta', `${String(i + 1).padStart(3, '0')}.txt`), d));
  const tags = [...new Set(seo('tags').flatMap(r => r.split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean)))];
  W(path.join(dir, 'tag.csv'), 'tag\n' + tags.map(csvCell).join('\n') + '\n');
  const end = seo('ending')[0]; if (end) W(path.join(dir, 'ket-hashtag.txt'), end);
  const th = all("SELECT line1,line2,sub_line FROM thumbnail_text WHERE pool_id=? AND status='active' ORDER BY id", tp.id);
  W(path.join(dir, 'chu-thumbnail.csv'), 'dong_1,dong_2,dong_phu\n' + th.map(t => [t.line1, t.line2 ?? '', t.sub_line ?? ''].map(csvCell).join(',')).join('\n') + '\n');
  let msg = `${tp.id}: ${seo('title').length} tiêu đề · ${md.length} mô tả · ${tags.length} tag · ${th.length} chữ thumb → ${dir}`;
  if (link) { run('UPDATE text_pool SET root_dir=? WHERE id=?', dir, tp.id); const r = syncTextPool(tp.id); msg += ` · quét: lỗi ${r.errors.length}${r.errors.length ? ' (' + r.errors.slice(0, 2).join(' | ') + ')' : ''}`; }
  console.log(msg);
}
