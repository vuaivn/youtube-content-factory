// m6-style.mjs — bảng kiểu chữ (thumbnail/phụ đề) + 2 cột chọn kiểu ở playlist (08/10/2026). Chạy mỗi lần khởi động, an toàn chạy lại.
import { openDb, all, get, run } from '../db/db.mjs';
import { BUILTIN } from '../recipe/styles.mjs';

export function migrateStyle() {
  const db = openDb();
  db.exec(`CREATE TABLE IF NOT EXISTS style (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('thumb','subtitle')),
    name       TEXT NOT NULL,
    params     TEXT NOT NULL,
    builtin    INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const cols = all('PRAGMA table_info(playlist)').map(c => c.name);
  // NULL = như cũ: thumbnail kiểu Cổ điển; phụ đề giữ nguyên cột subtitle_style hiện có
  if (!cols.includes('thumb_style_id')) db.exec('ALTER TABLE playlist ADD COLUMN thumb_style_id TEXT REFERENCES style(id)');
  if (!cols.includes('subtitle_style_id')) db.exec('ALTER TABLE playlist ADD COLUMN subtitle_style_id TEXT REFERENCES style(id)');
  for (const [id, kind, name, params] of BUILTIN)
    if (!get('SELECT 1 FROM style WHERE id=?', id)) run('INSERT INTO style (id,kind,name,params,builtin) VALUES (?,?,?,?,1)', id, kind, name, JSON.stringify(params));
}
