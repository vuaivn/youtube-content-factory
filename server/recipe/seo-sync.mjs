// seo-sync.mjs — đồng bộ kho SEO từ thư mục file (02/10, chuẩn docs/CHUAN-KHO-SEO.md).
//   tieu-de.csv (tieu_de) · mo-ta/*.txt · ket-hashtag.txt · tag.csv (tag) · chu-thumbnail.csv (dong_1,dong_2,dong_phu)
// File là nguồn sự thật: dòng mới → thêm; dòng biến mất → ngừng dùng (giữ used_count để chống lặp); có lại → dùng lại.
// Nhận diện mục = NỘI DUNG (sửa nội dung = mục mới).
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx } from '../db/db.mjs';

export const LIMITS = { title: 100, description: 4000, ending: 1000, tag: 100, thumb: 26, hashtags: 15 };
const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** Đọc file UTF-8 nghiêm ngặt (bỏ BOM). Sai mã → ném lỗi rõ ràng. */
export function readUtf8(file) {
  let s;
  try { s = UTF8.decode(fs.readFileSync(file)); }
  catch { throw new Error('không phải UTF-8 (lưu lại bằng "CSV UTF-8" / Encoding UTF-8)'); }
  return s.replace(/^\uFEFF/, '');
}

/** CSV chuẩn RFC 4180: ngoặc kép, dấu phẩy và xuống dòng trong ô. Trả mảng hàng (mảng ô) kèm số dòng bắt đầu. */
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false, line = 1, start = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else { if (c === '\n') line++; cell += c; }
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r') { /* bỏ */ }
    else if (c === '\n') { row.push(cell); rows.push({ cells: row, line: start }); row = []; cell = ''; line++; start = line; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push({ cells: row, line: start }); }
  return rows.filter(r => r.cells.some(x => x.trim() !== ''));
}

function readCsv(file, cols, errors, name, bad, kind) {
  if (!fs.existsSync(file)) { errors.push(`${name}: thiếu file — giữ nguyên dữ liệu cũ`); bad.add(kind); return []; }
  let rows;
  try { rows = parseCsv(readUtf8(file)); } catch (e) { errors.push(`${name}: ${e.message} — giữ nguyên dữ liệu cũ`); bad.add(kind); return []; }
  if (!rows.length) { errors.push(`${name}: file rỗng — giữ nguyên dữ liệu cũ`); bad.add(kind); return []; }
  const head = rows[0].cells.map(h => h.trim().toLowerCase());
  const idx = cols.map(c => head.indexOf(c));
  if (idx[0] < 0) { errors.push(`${name}: dòng đầu phải có cột "${cols[0]}" (đang là: ${head.join(', ')}) — giữ nguyên dữ liệu cũ`); bad.add(kind); return []; }
  return rows.slice(1).map(r => ({ line: r.line, v: idx.map(i => (i >= 0 ? (r.cells[i] ?? '') : '').trim()) }));
}

/** Đọc + kiểm thư mục → { items: {title[], description[], tags[], ending[], thumb[]}, errors[] } (không đụng DB). */
export function readSeoDir(dir) {
  const errors = [], bad = new Set();
  const items = { title: [], description: [], tags: [], ending: [], thumb: [] };
  if (!dir || !fs.existsSync(dir)) return { items, errors: ['Thư mục không tồn tại: ' + dir], bad: new Set(['title', 'description', 'tags', 'ending', 'thumb']) };
  for (const { line, v: [t] } of readCsv(path.join(dir, 'tieu-de.csv'), ['tieu_de'], errors, 'tieu-de.csv', bad, 'title')) {
    if (!t) continue;
    if (t.length > LIMITS.title) errors.push(`tieu-de.csv dòng ${line}: ${t.length} ký tự > ${LIMITS.title} — bỏ qua`);
    else items.title.push(t);
  }
  const md = path.join(dir, 'mo-ta');
  if (!fs.existsSync(md)) { errors.push('mo-ta/: thiếu thư mục — giữ nguyên dữ liệu cũ'); bad.add('description'); }
  else for (const f of fs.readdirSync(md).filter(x => x.toLowerCase().endsWith('.txt')).sort()) {
    let s; try { s = readUtf8(path.join(md, f)).trim(); } catch (e) { errors.push(`mo-ta/${f}: ${e.message}`); continue; }
    if (!s) continue;
    if (s.length > LIMITS.description) errors.push(`mo-ta/${f}: ${s.length} ký tự > ${LIMITS.description} — bỏ qua`);
    else items.description.push(s);
  }
  const ef = path.join(dir, 'ket-hashtag.txt');
  if (fs.existsSync(ef)) {
    try {
      const s = readUtf8(ef).trim();
      const nTag = (s.match(/(^|\s)#[^\s#]+/g) || []).length;
      if (s.length > LIMITS.ending) errors.push(`ket-hashtag.txt: ${s.length} ký tự > ${LIMITS.ending} — KHÔNG dùng`);
      else if (nTag > LIMITS.hashtags) errors.push(`ket-hashtag.txt: ${nTag} hashtag > ${LIMITS.hashtags} (YouTube sẽ bỏ hết hashtag) — KHÔNG dùng`);
      else if (s) items.ending.push(s);
    } catch (e) { errors.push('ket-hashtag.txt: ' + e.message); }
  }
  for (const { line, v: [t] } of readCsv(path.join(dir, 'tag.csv'), ['tag'], errors, 'tag.csv', bad, 'tags')) {
    const x = t.replace(/^#/, '').trim(); if (!x) continue;
    if (x.includes(',')) errors.push(`tag.csv dòng ${line}: mỗi dòng MỘT tag (đang có dấu phẩy) — bỏ qua`);
    else if (x.length > LIMITS.tag) errors.push(`tag.csv dòng ${line}: tag quá dài — bỏ qua`);
    else if (!items.tags.includes(x)) items.tags.push(x);
  }
  // 06/10: cảnh báo sớm — đếm như YouTube (tag có dấu cách +2 ngoặc kép, +1 dấu phẩy)
  const effLen = items.tags.reduce((s, x, i) => s + (/\s/.test(x) ? x.length + 2 : x.length) + (i ? 1 : 0), 0);
  if (effLen > 500) errors.push(`tag.csv: tổng ${effLen} ký tự (YouTube tính cả ngoặc kép) > 500 — khi upload chỉ lấy các tag đầu tới ~490`);
  for (const x of items.tags) if (/[<>]/.test(x)) errors.push(`tag.csv: tag "${x}" chứa < hoặc > (YouTube cấm) — sẽ bị bỏ`);
  for (const { line, v: [a, b, c] } of readCsv(path.join(dir, 'chu-thumbnail.csv'), ['dong_1', 'dong_2', 'dong_phu'], errors, 'chu-thumbnail.csv', bad, 'thumb')) {
    if (!a) continue;
    if (a.length > LIMITS.thumb || b.length > LIMITS.thumb) errors.push(`chu-thumbnail.csv dòng ${line}: dòng chữ lớn > ${LIMITS.thumb} ký tự — bỏ qua`);
    else items.thumb.push({ line1: a, line2: b || null, sub_line: c || null });
  }
  return { items, errors, bad };
}

/** Đồng bộ một kho SEO có root_dir. Kho không có root_dir → giữ nguyên (nhập tay như cũ). */
export function syncTextPool(poolId) {
  const tp = get('SELECT * FROM text_pool WHERE id=?', poolId);
  if (!tp) throw new Error('Không có kho chữ ' + poolId);
  if (!tp.root_dir) return { skipped: true, reason: 'kho chưa trỏ thư mục — dùng dữ liệu nhập trên web' };
  const { items, errors, bad } = readSeoDir(tp.root_dir);
  if (!fs.existsSync(tp.root_dir)) return { skipped: true, errors };
  const stat = {};
  tx(() => {
    for (const kind of ['title', 'description', 'tags', 'ending']) {
      if (bad.has(kind)) { stat[kind] = { active: all("SELECT 1 FROM seo_item WHERE pool_id=? AND kind=? AND status='active'", poolId, kind).length, added: 0, off: 0, back: 0, kept: true }; continue; }
      const want = new Set(items[kind]);
      const rows = all('SELECT id, content, status FROM seo_item WHERE pool_id=? AND kind=?', poolId, kind);
      const have = new Map(rows.map(r => [r.content, r]));
      let added = 0, off = 0, back = 0;
      for (const c of want) {
        const r = have.get(c);
        if (!r) { run('INSERT INTO seo_item (pool_id,kind,content) VALUES (?,?,?)', poolId, kind, c); added++; }
        else if (r.status !== 'active') { run("UPDATE seo_item SET status='active' WHERE id=?", r.id); back++; }
      }
      for (const r of rows) if (r.status === 'active' && !want.has(r.content)) { run("UPDATE seo_item SET status='removed' WHERE id=?", r.id); off++; }
      stat[kind] = { active: want.size, added, off, back };
    }
    if (!bad.has('thumb')) {
    const key = t => `${t.line1}\u0001${t.line2 ?? ''}\u0001${t.sub_line ?? ''}`;
    const want = new Map(items.thumb.map(t => [key(t), t]));
    const rows = all('SELECT id, line1, line2, sub_line, status FROM thumbnail_text WHERE pool_id=?', poolId);
    const have = new Map(rows.map(r => [key(r), r]));
    let added = 0, off = 0, back = 0;
    for (const [k, t] of want) {
      const r = have.get(k);
      if (!r) { run('INSERT INTO thumbnail_text (pool_id,line1,line2,sub_line) VALUES (?,?,?,?)', poolId, t.line1, t.line2, t.sub_line); added++; }
      else if (r.status !== 'active') { run("UPDATE thumbnail_text SET status='active' WHERE id=?", r.id); back++; }
    }
    for (const r of rows) if (r.status === 'active' && !want.has(key(r))) { run("UPDATE thumbnail_text SET status='removed' WHERE id=?", r.id); off++; }
    stat.thumb = { active: want.size, added, off, back };
    } else stat.thumb = { active: all("SELECT 1 FROM thumbnail_text WHERE pool_id=? AND status='active'", poolId).length, added: 0, off: 0, back: 0, kept: true };
  });
  const res = { stat, errors, at: new Date().toISOString() };
  run('UPDATE text_pool SET last_scan=? WHERE id=?', JSON.stringify(res), poolId);
  return res;
}
