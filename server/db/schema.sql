-- YouTube Content Factory — schema v1
-- Nguồn sự thật duy nhất. Mọi cấu hình nằm ở đây, không có file JSON cấu hình thứ hai.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ===== Kênh: CHỈ tài khoản, không giữ cấu hình sản xuất (thuốc cho bệnh B6)
CREATE TABLE IF NOT EXISTS channel (
  id            TEXT PRIMARY KEY,              -- 'alta', 'patt', ...
  name          TEXT NOT NULL,                 -- 'An Lạc Thiền Âm'
  youtube_id    TEXT,                          -- UC...
  secrets_file  TEXT,                          -- đường dẫn file OAuth token
  default_privacy TEXT NOT NULL DEFAULT 'private',
  token_status  TEXT NOT NULL DEFAULT 'unknown',  -- valid | expired | unknown
  token_checked_at TEXT,
  avatar_url    TEXT,
  subscriber_count TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Công thức dựng: DÙNG CHUNG nhiều playlist (nguyên tắc N3 — fade neo ở đây)
CREATE TABLE IF NOT EXISTS recipe (
  id            TEXT PRIMARY KEY,              -- 'sleep-4h', 'podcast-single'
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,                 -- 'hybrid-4h' | 'podcast' | ...
  total_seconds INTEGER,                       -- NULL = tự tính theo nội dung
  max_voice_ratio REAL NOT NULL DEFAULT 0.55,
  body_spec     TEXT NOT NULL,                 -- JSON: cấu trúc ruột (hook/story/outro)
  tail_spec     TEXT NOT NULL,                 -- JSON: [{kind:'music_only'|'black'|..., seconds}]
  on_body_overflow TEXT NOT NULL DEFAULT 'error', -- 'error' | 'trim' | 'extend'
  -- 4 mốc fade (giây) — đo từ video chuẩn GRMzzCA7Mcg; CHỈ áp lên nhánh nhạc
  fade_out_of_body_s  INTEGER NOT NULL DEFAULT 120,
  silence_gap_s       INTEGER NOT NULL DEFAULT 3,
  fade_into_tail_s    INTEGER NOT NULL DEFAULT 90,
  fade_end_of_video_s INTEGER NOT NULL DEFAULT 15,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Playlist: ĐƠN VỊ SẢN XUẤT THẬT (thuốc cho B1/B6)
CREATE TABLE IF NOT EXISTS playlist (
  id            TEXT PRIMARY KEY,              -- 'alta-sleep-4h'
  channel_id    TEXT NOT NULL REFERENCES channel(id),
  name          TEXT NOT NULL,
  youtube_playlist_id TEXT,
  youtube_playlist_name TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  recipe_id     TEXT NOT NULL REFERENCES recipe(id),
  recipe_override TEXT,                        -- JSON ghi đè từng trường công thức (hiếm dùng)
  subtitle_style TEXT NOT NULL DEFAULT 'brown-cream',
  preferred_frequency TEXT,                    -- '432 Hz'
  thumbnail_mode TEXT NOT NULL DEFAULT 'dynamic_vault',
  thumbnail_extract_offset_s INTEGER NOT NULL DEFAULT 150,
  episode_numbering INTEGER NOT NULL DEFAULT 0,
  caption_delay_hours INTEGER NOT NULL DEFAULT 6,
  privacy       TEXT NOT NULL DEFAULT 'private',
  dedupe_scope  TEXT NOT NULL DEFAULT 'playlist', -- 'playlist' | 'channel'
  text_pool_id  TEXT REFERENCES text_pool(id),   -- kho chữ thumbnail + SEO của playlist (B2, 30/09)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Kho tài nguyên (pool) + tài nguyên (asset) — thuốc cho B7
CREATE TABLE IF NOT EXISTS asset_pool (
  id            TEXT PRIMARY KEY,              -- 'buddhist', 'ben-binh-an'
  kind          TEXT NOT NULL,                 -- 'shot' | 'music' | 'hook' | 'story' | 'outro'
  name          TEXT NOT NULL,
  root_dir      TEXT NOT NULL,                 -- 'D:\story-library\buddhist'
  channel_id    TEXT REFERENCES channel(id),   -- NULL = dùng chung mọi kênh
  enabled       INTEGER NOT NULL DEFAULT 1,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS asset (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id       TEXT NOT NULL REFERENCES asset_pool(id),
  file_path     TEXT NOT NULL UNIQUE,
  title         TEXT,
  duration_s    REAL,
  md5           TEXT,
  tags          TEXT,                          -- JSON array
  note          TEXT,
  has_subtitle  INTEGER NOT NULL DEFAULT 0,    -- có .srt/.ass cùng tên
  sidecar_json  TEXT,                          -- nguyên văn sidecar nếu có
  status        TEXT NOT NULL DEFAULT 'active', -- 'active' | 'hidden' | 'removed'
                                               -- xoá trên UI = 'removed', KHÔNG chạm file gốc
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_asset_pool ON asset(pool_id, status);
CREATE INDEX IF NOT EXISTS idx_asset_md5  ON asset(md5);

-- ===== Playlist ↔ Kho, kèm trọng số (yêu cầu #3)
CREATE TABLE IF NOT EXISTS playlist_pool (
  playlist_id   TEXT NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
  pool_id       TEXT NOT NULL REFERENCES asset_pool(id),
  weight        REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (playlist_id, pool_id)
);

-- ===== Kho chữ thumbnail + SEO: chia theo POOL (kho), pool thuộc kênh (yêu cầu #4)
-- Thực tế app cũ: PQTA có 2 pool ('pqta' và 'pqta-4h') cho 2 playlist — nên pool là
-- đơn vị, kênh là chủ sở hữu. Một kênh có thể nhiều pool; playlist chọn pool nào dùng.
CREATE TABLE IF NOT EXISTS text_pool (
  id            TEXT PRIMARY KEY,              -- 'alta', 'pqta', 'pqta-4h'
  channel_id    TEXT NOT NULL REFERENCES channel(id),
  name          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS thumbnail_text (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id       TEXT NOT NULL REFERENCES text_pool(id),
  line1         TEXT NOT NULL,
  line2         TEXT,
  sub_line      TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  used_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_thumbtext_pool ON thumbnail_text(pool_id, status);

-- ===== SEO: title / description / tags / hashtag — thay 27 file seo-vault
CREATE TABLE IF NOT EXISTS seo_item (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id       TEXT NOT NULL REFERENCES text_pool(id),
  kind          TEXT NOT NULL,                 -- 'title' | 'description' | 'tags' | 'hashtag'
  content       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  used_count    INTEGER NOT NULL DEFAULT 0,    -- >0 nghĩa là đã dùng (di dời từ used-titles)
  last_used_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_seo_pool ON seo_item(pool_id, kind, status);

-- ===== Job bền qua restart (thuốc cho B8) — kế hoạch dựng lưu nguyên văn (thuốc cho B5)
CREATE TABLE IF NOT EXISTS job (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id   TEXT NOT NULL REFERENCES playlist(id),
  status        TEXT NOT NULL DEFAULT 'queued',
                -- queued | planning | rendering | verifying | uploading | done | failed | cancelled
  plan_json     TEXT,                          -- KẾ HOẠCH DỰNG đầy đủ (nguyên tắc N2)
  video_path    TEXT,
  youtube_video_id TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  started_at    TEXT,
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_status ON job(status);

CREATE TABLE IF NOT EXISTS job_step (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        INTEGER NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                 -- 'plan','render_body','render_tail','concat','subtitle','verify','upload',...
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | failed | skipped
  detail        TEXT,                          -- JSON: log/kết quả đối chiếu
  started_at    TEXT,
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobstep_job ON job_step(job_id);

-- ===== Chống lặp: tài nguyên nào đã dùng ở đâu (thay data\da-dung + rotation.mjs)
CREATE TABLE IF NOT EXISTS usage_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id      INTEGER REFERENCES asset(id),
  seo_item_id   INTEGER REFERENCES seo_item(id),
  thumbnail_text_id INTEGER REFERENCES thumbnail_text(id),
  playlist_id   TEXT NOT NULL REFERENCES playlist(id),
  job_id        INTEGER REFERENCES job(id),
  used_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_asset    ON usage_log(asset_id, playlist_id);
CREATE INDEX IF NOT EXISTS idx_usage_playlist ON usage_log(playlist_id);

-- ===== Công cụ ngoài: MỘT đường dẫn duy nhất mỗi công cụ (thuốc cho B10)
CREATE TABLE IF NOT EXISTS tool (
  name          TEXT PRIMARY KEY,              -- 'ffmpeg','python','compose','produce_py'
  path          TEXT NOT NULL,
  verified_at   TEXT
);

-- ===== Lịch sử cấu hình: thay file .bak (thuốc cho B9)
CREATE TABLE IF NOT EXISTS config_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name    TEXT NOT NULL,
  row_id        TEXT NOT NULL,
  before_json   TEXT,
  after_json    TEXT,
  changed_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- ===== B3 (30/09): chuỗi chạy nhiều playlist + lịch hẹn giờ VN =====
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
  notified      INTEGER NOT NULL DEFAULT 0,
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
);
