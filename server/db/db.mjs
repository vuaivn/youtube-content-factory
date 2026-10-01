// db.mjs — lớp bọc mỏng quanh node:sqlite (API thực nghiệm ở node 22).
// Mọi chỗ khác trong app CHỈ import file này, không import node:sqlite trực tiếp —
// nếu API đổi giữa các bản node thì chỉ sửa đúng một file.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(HERE, '..', '..', 'data');
const DB_PATH = process.env.YCF_DB || path.join(DATA_DIR, 'factory.db');
const SCHEMA = path.join(HERE, 'schema.sql');

let _db = null;

export function openDb() {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  _db.exec(fs.readFileSync(SCHEMA, 'utf8'));
  return _db;
}

export function closeDb() {
  if (_db) { _db.close(); _db = null; }
}

// --- tiện ích mỏng, tên rõ nghĩa ---
export function all(sql, ...params) { return openDb().prepare(sql).all(...params); }
export function get(sql, ...params) { return openDb().prepare(sql).get(...params); }
export function run(sql, ...params) { return openDb().prepare(sql).run(...params); }

// Giao dịch: node:sqlite chưa có helper transaction — tự bọc.
export function tx(fn) {
  const db = openDb();
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Ghi lịch sử cấu hình (thay .bak): gọi TRƯỚC khi UPDATE bản ghi cấu hình.
export function logConfigChange(tableName, rowId, before, after) {
  run(
    'INSERT INTO config_history (table_name, row_id, before_json, after_json) VALUES (?,?,?,?)',
    tableName, String(rowId),
    before == null ? null : JSON.stringify(before),
    after == null ? null : JSON.stringify(after),
  );
}

export { DB_PATH };
