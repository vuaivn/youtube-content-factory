// m7-manual.mjs - loại job "video thủ công" (11/2026). Chạy mỗi lần khởi động, an toàn chạy lại.
// job.kind: 'recipe' (mặc định, như cũ) | 'manual'. job.meta_json: tham số job thủ công (JSON).
// job.playlist_id NOT NULL + khoá ngoại → KHÔNG dựng lại bảng job; mỗi kênh có MỘT playlist "giữ chỗ"
// id = manualPlaylistId(channelId), archived=1, enabled=0 (không hiện ở danh sách playlist, lịch không chạy).
import { all, get, run } from '../db/db.mjs';

export const manualPlaylistId = channelId => `manual--${channelId}`;

export function migrateManual() {
  const cols = all('PRAGMA table_info(job)').map(c => c.name);
  if (!cols.includes('kind')) run("ALTER TABLE job ADD COLUMN kind TEXT NOT NULL DEFAULT 'recipe'");
  if (!cols.includes('meta_json')) run('ALTER TABLE job ADD COLUMN meta_json TEXT');
}

// Tạo (nếu chưa có) playlist giữ chỗ cho kênh. recipe_id NOT NULL → mượn recipe đầu tiên (không dùng tới).
export function ensureManualPlaylist(channelId) {
  const ch = get('SELECT id FROM channel WHERE id=?', channelId);
  if (!ch) throw new Error('Không có kênh ' + channelId);
  const id = manualPlaylistId(channelId);
  if (!get('SELECT 1 FROM playlist WHERE id=?', id)) {
    const rc = get('SELECT id FROM recipe ORDER BY id LIMIT 1');
    if (!rc) throw new Error('Chưa có recipe nào - không tạo được playlist giữ chỗ');
    run(`INSERT INTO playlist (id, channel_id, name, enabled, recipe_id, archived, archived_at)
      VALUES (?, ?, '[Video thủ công]', 0, ?, 1, datetime('now'))`, id, channelId, rc.id);
  }
  return id;
}
