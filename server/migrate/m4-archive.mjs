// m4-archive.mjs — cột "lưu trữ" cho kênh / playlist / kho (30/09: thay tính năng Xoá bằng Lưu trữ + Khôi phục).
// Chạy lại nhiều lần không sao (chỉ thêm cột khi chưa có).
import { all, run } from '../db/db.mjs';
export function migrateArchive() {
  for (const t of ['channel', 'playlist', 'asset_pool']) {
    const cols = all(`PRAGMA table_info(${t})`).map(c => c.name);
    if (!cols.includes('archived')) run(`ALTER TABLE ${t} ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
    if (!cols.includes('archived_at')) run(`ALTER TABLE ${t} ADD COLUMN archived_at TEXT`);
    // playlist lưu trữ THEO kênh (khôi phục kênh thì chỉ trả lại những playlist này, không đụng playlist lưu trữ riêng)
    if (t === 'playlist' && !cols.includes('archived_with_channel')) run(`ALTER TABLE playlist ADD COLUMN archived_with_channel INTEGER NOT NULL DEFAULT 0`);
  }
}
