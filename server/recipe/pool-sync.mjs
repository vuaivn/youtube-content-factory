// pool-sync.mjs — ĐỒNG BỘ kho với ổ đĩa (30/09, anh Vũ: "quét thấy còn 260 file mà DB vẫn giữ 803").
// Trước đây "Quét lại" chỉ THÊM file mới, không bao giờ gỡ file đã mất → app bốc trúng nhạc không còn
// trên ổ, dựng 157 phút ra video câm 2 giờ cuối.
// Giờ: file mới → thêm · file mất → status='missing' (không bốc nữa) · file 'missing' xuất hiện lại → 'active'.
// File anh tự ẩn ('hidden'/'removed') giữ nguyên, không đụng.
import fs from 'node:fs';
import { config, diskRoot } from '../config.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { get, all, run } from '../db/db.mjs';

export const VOICE_KINDS = ['hook', 'story', 'outro']; // bắt buộc có .srt đi kèm
const POOL_EXTS = { shot: ['.mp4', '.mov', '.webm'], music: ['.mp3', '.wav', '.flac', '.m4a', '.aac'], voice: ['.mp3', '.m4a', '.wav'], image: ['.jpg', '.jpeg', '.png', '.webp'] };
// 11/2026 video thủ công: kho 'voice' (giọng + .srt cùng tên, cây thư mục) và 'image' (ảnh, không đo thời lượng)
export const MANUAL_KINDS = ['voice', 'image'];
export const poolExts = kind => POOL_EXTS[kind] ?? POOL_EXTS.voice;

// Đo thời lượng (ffprobe) + md5 cho file MỚI nhập — plan.mjs cần duration_s > 0 mới chọn được.
export function probeFile(fp) {
  const ffmpeg = (config.ffmpeg || get("SELECT path FROM tool WHERE name='ffmpeg'")?.path || 'ffmpeg');
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, m => m.replace(/ffmpeg/i, 'ffprobe'));
  const r = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', fp], { encoding: 'utf8', timeout: 60_000 });
  const dur = parseFloat(r.stdout);
  const h = crypto.createHash('md5'); const fd = fs.openSync(fp, 'r'); const buf = Buffer.alloc(4 << 20);
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  return { duration_s: Number.isFinite(dur) && dur > 0 ? dur : null, md5: h.digest('hex'), size: fs.statSync(fp).size };
}

function md5Of(fp) { return crypto.createHash('md5').update(fs.readFileSync(fp)).digest('hex'); }

// Đánh dấu file mất / khôi phục file quay lại — KHÔNG đọc thư mục, chỉ kiểm từng đường dẫn (nhanh).
export function markMissing(poolId) {
  let missing = 0, restored = 0;
  for (const a of all("SELECT id, file_path, status FROM asset WHERE pool_id=? AND status IN ('active','missing')", poolId)) {
    const exists = fs.existsSync(a.file_path);
    if (a.status === 'active' && !exists) { run("UPDATE asset SET status='missing', updated_at=datetime('now') WHERE id=?", a.id); missing++; }
    else if (a.status === 'missing' && exists) { run("UPDATE asset SET status='active', updated_at=datetime('now') WHERE id=?", a.id); restored++; }
  }
  const active = get("SELECT COUNT(*) n FROM asset WHERE pool_id=? AND status='active'", poolId).n;
  return { missing, restored, active };
}

// 04/10: tiêu đề lấy từ phiếu .json cùng tên (trường tieuDe, dự phòng title) — trước đây lấy TÊN FILE
// nên mục lục mô tả video hiện "co-giao-va-loi-khen--thien-tam". Thử: <stem>.json, rồi <stem bỏ --giọng>.json.
// Không bao giờ đọc *.words.json. Không có phiếu → dùng tên file như cũ.
export function readSidecar(fp) {
  const stem = fp.replace(/\.[^.]+$/, '');
  const cands = [stem + '.json', stem.replace(/--[^\\/]+$/, '') + '.json'];
  for (const c of cands) {
    if (/\.words\.json$/i.test(c) || !fs.existsSync(c)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(c, 'utf8').replace(/^\uFEFF/, ''));
      const t = String(j.tieuDe ?? j.title ?? '').trim();
      return { title: t || null, json: JSON.stringify(j) };
    } catch { /* phiếu hỏng → bỏ qua */ }
  }
  return { title: null, json: null };
}
const stemOf = fp => path.basename(fp, path.extname(fp));

// Quét đầy đủ: thêm file mới + đánh dấu mất/khôi phục. Trả số liệu SAU khi đồng bộ.
export function syncPool(poolId) {
  const pool = get('SELECT * FROM asset_pool WHERE id=?', poolId);
  if (!pool) throw new Error('Không có kho ' + poolId);
  if (!fs.existsSync(pool.root_dir)) {
    const m = markMissing(poolId);
    return { seen: 0, added: 0, rejected: [], ...m, warning: 'Thư mục kho không tồn tại: ' + pool.root_dir };
  }
  const exts = poolExts(pool.kind);
  const needSub = VOICE_KINDS.includes(pool.kind) || pool.kind === 'voice';
  const isImage = pool.kind === 'image';
  let added = 0, seen = 0, retitled = 0; const rejected = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('_') && !['audio', 'out-final'].includes(e.name.toLowerCase())) walk(fp); continue; }
      if (!exts.includes(path.extname(e.name).toLowerCase())) continue;
      seen++;
      const ex = get('SELECT id, title FROM asset WHERE file_path=?', fp);
      if (ex) {
        // chỉ sửa tiêu đề còn đang là TÊN FILE — tiêu đề anh đã sửa tay thì giữ nguyên
        if (ex.title === stemOf(fp)) {
          const sc = readSidecar(fp);
          if (sc.title && sc.title !== ex.title) {
            run("UPDATE asset SET title=?, sidecar_json=COALESCE(sidecar_json, ?), updated_at=datetime('now') WHERE id=?", sc.title, sc.json, ex.id);
            retitled++;
          }
        }
        continue;
      }
      {
        const hasSub = fs.existsSync(fp.replace(/\.[^.]+$/, '.srt')) || fs.existsSync(fp.replace(/\.[^.]+$/, '.ass'));
        if (needSub && !hasSub) { rejected.push(e.name); continue; } // thiếu phụ đề → từ chối
        const pr = isImage ? { duration_s: 0, md5: md5Of(fp) } : probeFile(fp);
        if (!isImage && !pr.duration_s) { rejected.push(e.name + ' (không đọc được thời lượng — file hỏng?)'); continue; }
        const sc = readSidecar(fp);
        run('INSERT INTO asset (pool_id,file_path,title,has_subtitle,duration_s,md5,sidecar_json) VALUES (?,?,?,?,?,?,?)',
          poolId, fp, isImage ? stemOf(fp) : (sc.title || stemOf(fp)), hasSub ? 1 : 0, isImage ? null : pr.duration_s, pr.md5, isImage ? null : sc.json);
        added++;
      }
    }
  })(pool.root_dir);
  return { seen, added, retitled, rejected, ...markMissing(poolId) };
}
