// m3-queue.mjs — Bước 3 (30/09): bảng chuỗi chạy nhiều playlist + lịch hẹn giờ (giờ Việt Nam).
// Chạy lại nhiều lần vẫn an toàn (CREATE IF NOT EXISTS). Nội dung khớp khối B3 trong schema.sql.
import { openDb } from '../db/db.mjs';
export const QUEUE_SQL = `
CREATE TABLE IF NOT EXISTS chain (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'manual',   -- 'manual' | 'schedule'
  schedule_id   INTEGER,
  status        TEXT NOT NULL DEFAULT 'queued',   -- queued | running | paused | done | cancelled
  log_file      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  started_at    TEXT,
  finished_at   TEXT
);
CREATE TABLE IF NOT EXISTS chain_item (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id      INTEGER NOT NULL REFERENCES chain(id),
  position      INTEGER NOT NULL,
  playlist_id   TEXT NOT NULL REFERENCES playlist(id),
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed | cancelled
  stage         TEXT,                             -- bước đang chạy (hiển thị)
  job_id        INTEGER,
  pid           INTEGER,
  progress_sig  TEXT,                             -- dấu tiến độ gần nhất (byte/mtime/cpu)
  last_progress_at TEXT,
  youtube_video_id TEXT,
  error         TEXT,
  log_file      TEXT,
  notified      INTEGER NOT NULL DEFAULT 0,       -- đã báo Telegram kết quả kênh này
  started_at    TEXT,
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_chain_item ON chain_item(chain_id, position);
CREATE TABLE IF NOT EXISTS schedule (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  time_vn       TEXT NOT NULL,                    -- 'HH:MM' giờ Việt Nam, chạy mỗi ngày
  playlist_ids  TEXT NOT NULL,                    -- JSON mảng theo thứ tự
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_run_date_vn TEXT,                          -- 'YYYY-MM-DD' ngày VN đã chạy gần nhất
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);`;
export function migrateQueue() {
  const db = openDb(); db.exec(QUEUE_SQL);
  const cols = db.prepare('PRAGMA table_info(chain_item)').all().map(c => c.name);
  if (!cols.includes('notified')) db.exec('ALTER TABLE chain_item ADD COLUMN notified INTEGER NOT NULL DEFAULT 0');
}
if (process.argv[1]?.endsWith('m3-queue.mjs')) { migrateQueue(); console.log('XONG bảng chain / chain_item / schedule'); }
