// server.mjs — YouTube Content Factory HTTP server (node:http, zero-dependency).
// API tiếng Anh, JSON. Giao diện tĩnh ở ../public.
// Cổng 18990 (app cũ chạy cổng khác — hai app sống song song tới M6).
import http from 'node:http';
import { config, diskRoot } from './config.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, all, get, run, tx, logConfigChange } from './db/db.mjs';
import { buildPlan } from './recipe/plan.mjs';
import { checkResources, checkSystem } from './recipe/validate.mjs';
import { syncPool, markMissing, probeFile, poolExts, VOICE_KINDS } from './recipe/pool-sync.mjs';
import { migrateArchive } from './migrate/m4-archive.mjs';
import { migrateSeo } from './migrate/m5-seo.mjs';
import { migrateStyle } from './migrate/m6-style.mjs';
import { registerStyleRoutes, syncSubtitleStyle } from './routes-style.mjs';
import { syncTextPool } from './recipe/seo-sync.mjs';
import { startSupervisor, createChain, getChain, listChains, pauseChain, resumeChain, cancelChain, saveSchedule } from './execute/queue.mjs';
import { LOG_DIR, vnFromSql, vnStamp } from './execute/notify.mjs';
import { startAuth, finishAuth, checkAllTokens } from './execute/oauth.mjs';
import { registerUpdateRoutes } from './update.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, '..', 'public');
const PORT = config.port;
// IP Tailscale của máy (dải CGNAT 100.64.0.0/10) — đọc lúc khởi động, không có thì chỉ loopback.
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const TAILSCALE_IP = Object.values(os.networkInterfaces()).flat()
  .find(a => a && a.family === 'IPv4' && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address))?.address ?? null;
openDb();
migrateArchive(); // 30/09: cột lưu trữ kênh/playlist/kho
migrateStyle();   // 08/10: kiểu chữ thumbnail / phụ đề
migrateSeo();     // 02/10: kho SEO từ thư mục file

// ---------- helpers ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
function send(res, code, body, type = 'application/json; charset=utf-8') {
  const data = type.startsWith('application/json') ? JSON.stringify(body) : body;
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 10 * 1024 * 1024) reject(new Error('body too large')); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}
// Bảo vệ ghi cấu hình: lưu bản trước vào config_history (thay .bak — bệnh B9)
function updateWithHistory(table, id, fields, allowed) {
  const before = get(`SELECT * FROM ${table} WHERE id=?`, id);
  if (!before) return null;
  const keys = Object.keys(fields).filter(k => allowed.includes(k));
  if (!keys.length) return before;
  tx(() => {
    logConfigChange(table, id, before, { ...before, ...fields });
    run(`UPDATE ${table} SET ${keys.map(k => k + '=?').join(', ')} WHERE id=?`, ...keys.map(k => fields[k]), id);
  });
  return get(`SELECT * FROM ${table} WHERE id=?`, id);
}

// ---------- API routes ----------
const routes = [];
function route(method, pattern, handler) {
  // pattern: '/api/channel/:id' → regex, params
  const names = [];
  const re = new RegExp('^' + pattern.replace(/:[^/]+/g, m => { names.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, re, names, handler });
}
registerUpdateRoutes(route); // 18/11: tự cập nhật 1 nút

// ===== Công thức theo playlist (B2, 30/09): form nhập PHÚT ↔ recipe lưu GIÂY =====
// Mỗi playlist sở hữu MỘT recipe riêng (không dùng chung — sửa playlist này không ảnh hưởng playlist khác).
const num = (v, name, { min = 0, allowNull = false } = {}) => {
  if ((v === null || v === '' || v === undefined) && allowNull) return null;
  const x = Number(v);
  if (!Number.isFinite(x) || x < min) throw new Error(`${name} phải là số ≥ ${min}`);
  return x;
};
function formulaToRecipe(f = {}) {
  const mode = f.story_mode === 'fixed' ? 'fixed' : 'fill';
  const total = num(f.total_min, 'Tổng thời lượng (phút)', { min: 1, allowNull: mode === 'fixed' });
  if (mode === 'fill' && total == null) throw new Error('Chế độ "tự thêm truyện cho đủ" cần nhập tổng thời lượng');
  const storyCount = mode === 'fixed' ? num(f.story_count, 'Số truyện', { min: 1 }) : undefined;
  if (mode === 'fixed' && !Number.isInteger(storyCount)) throw new Error('Số truyện phải là số nguyên');
  const bg = num(f.bg_min ?? 0, 'Hình nền (phút)'), black = num(f.black_min ?? 0, 'Màn đen (phút)');
  if (total != null && bg + black >= total) throw new Error(`Phần đuôi (${bg + black} phút) phải nhỏ hơn tổng (${total} phút)`);
  const body = { hook: f.hook !== false, outro: f.outro !== false, stories: mode, gapSeconds: num(f.gap_s ?? 2, 'Khoảng nghỉ giữa đoạn (giây)') };
  if (mode === 'fixed') body.storyCount = storyCount;
  return {
    total_seconds: total == null ? null : Math.round(total * 60),
    max_voice_ratio: num(f.max_voice_pct ?? 55, 'Tỉ lệ giọng tối đa (%)', { min: 1 }) / 100,
    body_spec: JSON.stringify(body),
    tail_spec: JSON.stringify([{ kind: 'background', seconds: Math.round(bg * 60) }, { kind: 'black', seconds: Math.round(black * 60) }]),
    fade_out_of_body_s: num(f.fade_out_s ?? 120, 'Fade ra khỏi giọng (giây)'),
    silence_gap_s: num(f.silence_s ?? 3, 'Khoảng lặng (giây)'),
    fade_into_tail_s: num(f.fade_in_s ?? 90, 'Nhạc dâng (giây)'),
    fade_end_of_video_s: num(f.fade_end_s ?? 15, 'Fade cuối video (giây)'),
  };
}
function recipeToFormula(r) {
  if (!r) return null;
  const b = JSON.parse(r.body_spec || '{}'), t = JSON.parse(r.tail_spec || '[]');
  const sec = k => t.filter(x => (k === 'black') === (x.kind === 'black')).reduce((a, x) => a + (Number.isFinite(x.seconds) ? x.seconds : 0), 0);
  return {
    total_min: r.total_seconds == null ? null : r.total_seconds / 60,
    story_mode: b.stories === 'fixed' ? 'fixed' : 'fill', story_count: b.storyCount ?? 1,
    hook: b.hook !== false, outro: b.outro !== false, gap_s: b.gapSeconds ?? 2,
    bg_min: sec('bg') / 60, black_min: sec('black') / 60,
    max_voice_pct: Math.round((r.max_voice_ratio ?? 0.55) * 100),
    fade_out_s: r.fade_out_of_body_s, silence_s: r.silence_gap_s, fade_in_s: r.fade_into_tail_s, fade_end_s: r.fade_end_of_video_s,
  };
}
const PL_FIELDS = ['name', 'youtube_playlist_id', 'youtube_playlist_name', 'enabled', 'subtitle_style', 'preferred_frequency',
  'thumbnail_mode', 'thumbnail_extract_offset_s', 'episode_numbering', 'caption_delay_hours', 'privacy', 'dedupe_scope', 'text_pool_id', 'thumb_style_id', 'subtitle_style_id'];
function savePools(playlistId, poolIds) {
  if (!Array.isArray(poolIds)) return;
  for (const id of poolIds) if (!get('SELECT 1 FROM asset_pool WHERE id=?', id)) throw new Error('Không có kho ' + id);
  run('DELETE FROM playlist_pool WHERE playlist_id=?', playlistId);
  for (const id of poolIds) run('INSERT INTO playlist_pool (playlist_id,pool_id,weight) VALUES (?,?,1)', playlistId, id);
}
function saveRecipe(recipeId, name, kind, formula) {
  const rec = formulaToRecipe(formula);
  const before = get('SELECT * FROM recipe WHERE id=?', recipeId);
  if (before) {
    run(`UPDATE recipe SET name=?, total_seconds=?, max_voice_ratio=?, body_spec=?, tail_spec=?, fade_out_of_body_s=?,
      silence_gap_s=?, fade_into_tail_s=?, fade_end_of_video_s=?, updated_at=datetime('now') WHERE id=?`,
      name, rec.total_seconds, rec.max_voice_ratio, rec.body_spec, rec.tail_spec, rec.fade_out_of_body_s,
      rec.silence_gap_s, rec.fade_into_tail_s, rec.fade_end_of_video_s, recipeId);
  } else {
    run(`INSERT INTO recipe (id,name,kind,total_seconds,max_voice_ratio,body_spec,tail_spec,fade_out_of_body_s,silence_gap_s,
      fade_into_tail_s,fade_end_of_video_s) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      recipeId, name, kind, rec.total_seconds, rec.max_voice_ratio, rec.body_spec, rec.tail_spec,
      rec.fade_out_of_body_s, rec.silence_gap_s, rec.fade_into_tail_s, rec.fade_end_of_video_s);
  }
  logConfigChange('recipe', recipeId, before ?? null, get('SELECT * FROM recipe WHERE id=?', recipeId));
}
const recipeKind = f => (f?.black_min > 0 || (f?.total_min ?? 0) >= 120) ? 'hybrid-4h' : 'podcast';

// ===== Channels =====
route('GET', '/api/channel', () => all(`
  SELECT c.*, (SELECT COUNT(*) FROM playlist p WHERE p.channel_id=c.id AND p.archived=0) AS playlist_count
  FROM channel c WHERE c.archived=0 ORDER BY c.name`));
route('PUT', '/api/channel/:id', (p, body) =>
  updateWithHistory('channel', p.id, body, ['name', 'youtube_id', 'secrets_file', 'default_privacy', 'enabled', 'avatar_url']));

// ===== Playlists (yêu cầu #5: cây kênh → playlist, CRUD) =====
route('GET', '/api/channel/:id/playlist', p => all('SELECT * FROM playlist WHERE channel_id=? AND archived=0 ORDER BY name', p.id));
route('GET', '/api/playlist/:id', p => {
  const pl = get('SELECT * FROM playlist WHERE id=?', p.id);
  if (!pl) return null;
  pl.recipe = get('SELECT * FROM recipe WHERE id=?', pl.recipe_id);
  pl.formula = recipeToFormula(pl.recipe);
  pl.pools = all(`
    SELECT pp.pool_id, pp.weight, ap.kind, ap.name, ap.root_dir,
      (SELECT COUNT(*) FROM asset a WHERE a.pool_id=ap.id AND a.status='active') AS asset_count,
      (SELECT ROUND(SUM(a.duration_s)/60,1) FROM asset a WHERE a.pool_id=ap.id AND a.status='active') AS total_minutes,
      (SELECT COUNT(*) FROM asset a WHERE a.pool_id=ap.id AND a.status='active'
         AND NOT EXISTS (SELECT 1 FROM usage_log u WHERE u.asset_id=a.id AND u.playlist_id=?)) AS unused_count
    FROM playlist_pool pp JOIN asset_pool ap ON ap.id=pp.pool_id AND ap.archived=0
    WHERE pp.playlist_id=? ORDER BY ap.kind, ap.name`, p.id, p.id);
  return pl;
});
route('POST', '/api/playlist', (p, body) => {
  for (const k of ['id', 'channel_id', 'name']) if (!body[k]) throw new Error('Thiếu ' + k);
  if (!/^[a-z0-9_][a-z0-9_-]{1,40}$/.test(body.id)) throw new Error('Mã playlist: chữ thường, số, gạch ngang/gạch dưới (2–41 ký tự)');
  if (get('SELECT 1 FROM playlist WHERE id=?', body.id)) throw new Error('Mã playlist đã tồn tại: ' + body.id);
  if (!get('SELECT 1 FROM channel WHERE id=?', body.channel_id)) throw new Error('Không có kênh ' + body.channel_id);
  const recipeId = 'rcp-' + body.id;
  tx(() => {
    saveRecipe(recipeId, body.name, recipeKind(body.formula), body.formula ?? {});
    run('INSERT INTO playlist (id,channel_id,name,recipe_id) VALUES (?,?,?,?)', body.id, body.channel_id, body.name, recipeId);
    const fields = Object.fromEntries(PL_FIELDS.filter(k => k in body && k !== 'name').map(k => [k, body[k]]));
    for (const [k, v] of Object.entries(fields)) run(`UPDATE playlist SET ${k}=? WHERE id=?`, v, body.id);
    savePools(body.id, body.pool_ids);
    logConfigChange('playlist', body.id, null, get('SELECT * FROM playlist WHERE id=?', body.id));
  });
  return get('SELECT * FROM playlist WHERE id=?', body.id);
});
// Lưu TOÀN BỘ cấu hình playlist (thông tin + công thức riêng + kho) — một giao dịch, lỗi thì không ghi gì
route('PUT', '/api/playlist/:id/config', (p, body) => {
  const pl = get('SELECT * FROM playlist WHERE id=?', p.id);
  if (!pl) throw new Error('Không có playlist ' + p.id);
  tx(() => {
    const f = body.fields ?? {};
    const keys = PL_FIELDS.filter(k => k in f);
    if (keys.length) { // không gọi updateWithHistory ở đây: nó tự mở giao dịch, lồng vào tx() sẽ lỗi
      logConfigChange('playlist', p.id, pl, { ...pl, ...f });
      run(`UPDATE playlist SET ${keys.map(k => k + '=?').join(', ')}, updated_at=datetime('now') WHERE id=?`, ...keys.map(k => f[k]), p.id);
    }
    if (body.formula) saveRecipe(pl.recipe_id, f.name ?? pl.name, recipeKind(body.formula), body.formula);
    savePools(p.id, body.pool_ids);
    syncSubtitleStyle(p.id);
  });
  return get('SELECT * FROM playlist WHERE id=?', p.id);
});
// Xem trước kế hoạch với cấu hình CHƯA lưu (form đang sửa)
route('POST', '/api/playlist-preview', (p, body) => {
  const rec = formulaToRecipe(body.formula ?? {});
  const recipe = { id: 'preview', kind: recipeKind(body.formula), ...rec, body_spec: JSON.parse(rec.body_spec), tail_spec: JSON.parse(rec.tail_spec) };
  const ids = Array.isArray(body.pool_ids) ? body.pool_ids : [];
  const rows = ids.length ? all(`SELECT a.*, ap.kind AS pool_kind FROM asset a JOIN asset_pool ap ON ap.id=a.pool_id
    WHERE a.status='active' AND ap.id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  const by = k => rows.filter(r => r.pool_kind === k);
  const assets = { hooks: by('hook'), stories: by('story'), outros: by('outro'), shots: by('shot'), musics: by('music') };
  const usedIds = body.playlist_id ? usedIdsFor(body.playlist_id, body.dedupe_scope ?? 'playlist') : new Set();
  const r = buildPlan(recipe, assets, { seed: body.seed ?? 1, usedIds });
  return { ok: r.ok, errors: r.errors, warnings: r.warnings, plan: r.plan ? { total_s: r.plan.total_s, voice_end_s: r.plan.voice_end_s, tail_len_s: r.plan.tail_len_s, timeline: r.plan.timeline, fades: r.plan.fades } : null };
});
route('PUT', '/api/playlist/:id', (p, body) =>
  updateWithHistory('playlist', p.id, body,
    PL_FIELDS));
route('DELETE', '/api/playlist/:id', p => {
  const before = get('SELECT * FROM playlist WHERE id=?', p.id);
  if (!before) return { deleted: false };
  tx(() => {
    logConfigChange('playlist', p.id, before, null);
    run('DELETE FROM playlist WHERE id=?', p.id);
    // công thức là của riêng playlist → xoá theo nếu không playlist nào khác dùng (lịch sử vẫn giữ)
    const rec = get('SELECT * FROM recipe WHERE id=?', before.recipe_id);
    if (rec && !get('SELECT 1 FROM playlist WHERE recipe_id=?', rec.id)) {
      logConfigChange('recipe', rec.id, rec, null);
      run('DELETE FROM recipe WHERE id=?', rec.id);
    }
    // 05/10: kho SEO tạo kèm lúc nhân bản (cùng mã playlist) — xoá theo nếu còn TRỐNG và không ai dùng
    const tp = get('SELECT * FROM text_pool WHERE id=?', before.text_pool_id);
    if (tp && tp.id === p.id && !get('SELECT 1 FROM playlist WHERE text_pool_id=?', tp.id)
        && !get('SELECT 1 FROM seo_item WHERE pool_id=?', tp.id) && !get('SELECT 1 FROM thumbnail_text WHERE pool_id=?', tp.id)) {
      run('DELETE FROM text_pool WHERE id=?', tp.id);
      if (tp.root_dir) try { fs.rmdirSync(tp.root_dir); } catch {} // chỉ xoá thư mục RỖNG
    }
  });
  return { deleted: true };
});
route('POST', '/api/playlist/:id/clone', (p, body) => {
  const src = get('SELECT * FROM playlist WHERE id=?', p.id);
  if (!src) throw new Error('Không có playlist ' + p.id);
  const nid = body.new_id; if (!nid) throw new Error('Thiếu new_id');
  if (!/^[a-z0-9_][a-z0-9_-]{1,40}$/.test(nid)) throw new Error('Mã playlist: chữ thường, số, gạch ngang/gạch dưới (2–41 ký tự)');
  if (get('SELECT 1 FROM playlist WHERE id=?', nid)) throw new Error('Mã playlist đã tồn tại: ' + nid);
  const newRecipe = 'rcp-' + nid;
  tx(() => {
    run(`INSERT INTO recipe (id,name,kind,total_seconds,max_voice_ratio,body_spec,tail_spec,on_body_overflow,fade_out_of_body_s,
          silence_gap_s,fade_into_tail_s,fade_end_of_video_s)
         SELECT ?,?,kind,total_seconds,max_voice_ratio,body_spec,tail_spec,on_body_overflow,fade_out_of_body_s,
          silence_gap_s,fade_into_tail_s,fade_end_of_video_s FROM recipe WHERE id=?`, newRecipe, body.new_name ?? (src.name + ' (bản sao)'), src.recipe_id);
    run(`INSERT INTO playlist (id,channel_id,name,youtube_playlist_id,enabled,recipe_id,recipe_override,subtitle_style,
          preferred_frequency,thumbnail_mode,thumbnail_extract_offset_s,episode_numbering,caption_delay_hours,privacy,dedupe_scope,thumb_style_id,subtitle_style_id)
         SELECT ?,channel_id,?,NULL,0,?,recipe_override,subtitle_style,preferred_frequency,thumbnail_mode,
           thumbnail_extract_offset_s,episode_numbering,caption_delay_hours,privacy,dedupe_scope,thumb_style_id,subtitle_style_id FROM playlist WHERE id=?`,
      nid, body.new_name ?? (src.name + ' (bản sao)'), newRecipe, p.id);
    // 05/10: bản sao có kho SEO MỚI, TRỐNG (anh Vũ chốt) — thư mục cạnh thư mục kho gốc: seo-<mã playlist mới>
    const srcTp = src.text_pool_id ? get('SELECT * FROM text_pool WHERE id=?', src.text_pool_id) : null;
    if (get('SELECT 1 FROM text_pool WHERE id=?', nid)) throw new Error('Đã có kho SEO mã ' + nid + ' — đổi mã playlist');
    const ndir = srcTp?.root_dir ? path.join(path.dirname(srcTp.root_dir), 'seo-' + nid) : null;
    if (ndir) fs.mkdirSync(ndir, { recursive: true });
    run('INSERT INTO text_pool (id,channel_id,name,root_dir) VALUES (?,?,?,?)', nid, src.channel_id, body.new_name ?? (src.name + ' (bản sao)'), ndir);
    run('UPDATE playlist SET text_pool_id=? WHERE id=?', nid, nid);
    run('INSERT INTO playlist_pool (playlist_id,pool_id,weight) SELECT ?,pool_id,weight FROM playlist_pool WHERE playlist_id=?', nid, p.id);
  });
  return get('SELECT * FROM playlist WHERE id=?', nid);
});
// Gán kho cho playlist (yêu cầu #3)
route('PUT', '/api/playlist/:id/pools', (p, body) => {
  if (!Array.isArray(body.pools)) throw new Error('pools phải là mảng [{pool_id, weight}]');
  tx(() => {
    run('DELETE FROM playlist_pool WHERE playlist_id=?', p.id);
    for (const x of body.pools) run('INSERT INTO playlist_pool (playlist_id,pool_id,weight) VALUES (?,?,?)', p.id, x.pool_id, x.weight ?? 1);
  });
  return all('SELECT * FROM playlist_pool WHERE playlist_id=?', p.id);
});

// ===== Recipes (fade neo ở đây — công thức dùng chung) =====
route('GET', '/api/recipe', () => all('SELECT * FROM recipe ORDER BY name'));
route('PUT', '/api/recipe/:id', (p, body) =>
  updateWithHistory('recipe', p.id, body,
    ['name', 'total_seconds', 'max_voice_ratio', 'body_spec', 'tail_spec', 'on_body_overflow',
      'fade_out_of_body_s', 'silence_gap_s', 'fade_into_tail_s', 'fade_end_of_video_s']));

// ===== Asset pools + assets (yêu cầu #2: CRUD tài nguyên) =====
route('GET', '/api/pool', () => all(`
  SELECT ap.*, COUNT(a.id) AS asset_count, ROUND(SUM(a.duration_s)/60,1) AS total_minutes
  FROM asset_pool ap LEFT JOIN asset a ON a.pool_id=ap.id AND a.status='active'
  WHERE ap.archived=0
  GROUP BY ap.id ORDER BY ap.kind, ap.name`));
const POOL_KINDS = ['hook', 'story', 'outro', 'shot', 'music'];
// VOICE_KINDS / poolExts / probeFile chuyển sang recipe/pool-sync.mjs (30/09)
route('POST', '/api/pool', (p, body) => {
  for (const k of ['id', 'kind', 'name', 'root_dir']) if (!body[k]) throw new Error('Thiếu ' + k);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(body.id)) throw new Error('Mã kho chỉ gồm chữ thường, số, dấu gạch ngang');
  if (!POOL_KINDS.includes(body.kind)) throw new Error('Loại kho không hợp lệ: ' + body.kind);
  if (get('SELECT id FROM asset_pool WHERE id=?', body.id)) throw new Error('Đã có kho mã ' + body.id);
  fs.mkdirSync(body.root_dir, { recursive: true }); // thư mục chưa có thì tạo
  run('INSERT INTO asset_pool (id,kind,name,root_dir,channel_id) VALUES (?,?,?,?,?)',
    body.id, body.kind, body.name, body.root_dir, body.channel_id ?? null);
  return get('SELECT * FROM asset_pool WHERE id=?', body.id);
});
route('PUT', '/api/pool/:id', (p, body) => { // sửa tên + đường dẫn thư mục của CẢ kho
  if (body.root_dir != null && !(fs.existsSync(body.root_dir) && fs.statSync(body.root_dir).isDirectory()))
    throw new Error('Thư mục không tồn tại: ' + body.root_dir);
  const pool = get('SELECT * FROM asset_pool WHERE id=?', p.id);
  if (!pool) return null;
  let moved = 0, missing = 0;
  if (body.root_dir != null && path.resolve(body.root_dir) !== path.resolve(pool.root_dir)) {
    // Đổi thư mục: file cũ đã nhập phải có mặt ở thư mục mới (cùng đường dẫn con) thì chuyển theo;
    // thiếu dù chỉ 1 file → từ chối, tránh để lại mục "ma" trỏ vào thư mục cũ.
    const rows = all("SELECT id, file_path FROM asset WHERE pool_id=? AND status='active'", p.id);
    const plan = rows.map(a => ({ id: a.id, to: path.join(body.root_dir, path.relative(pool.root_dir, a.file_path)) }));
    const miss = plan.filter(x => !fs.existsSync(x.to));
    if (miss.length) throw new Error(`Không đổi được: ${miss.length}/${rows.length} file của kho không có ở thư mục mới (vd ${path.basename(miss[0].to)}). Hãy chép đủ file sang trước.`);
    tx(() => { for (const x of plan) run("UPDATE asset SET file_path=?, updated_at=datetime('now') WHERE id=?", x.to, x.id); });
    moved = plan.length;
  }
  const out = updateWithHistory('asset_pool', p.id, body, ['name', 'root_dir']);
  return { ...out, moved_assets: moved, missing };
});
route('GET', '/api/pool/:id/asset', (p, body, q) => {
  const status = q.get('status') ?? 'active';
  const filter = q.get('q');
  let sql = `SELECT a.*, (SELECT COUNT(*) FROM usage_log u WHERE u.asset_id=a.id) AS used_total,
    (SELECT MAX(u.used_at) FROM usage_log u WHERE u.asset_id=a.id) AS last_used
    FROM asset a WHERE a.pool_id=? AND a.status=?`;
  const args = [p.id, status];
  if (filter) { sql += ` AND (a.title LIKE ? OR a.file_path LIKE ? OR a.tags LIKE ?)`; args.push(`%${filter}%`, `%${filter}%`, `%${filter}%`); }
  sql += ' ORDER BY a.title LIMIT 500';
  return all(sql, ...args);
});
route('PUT', '/api/asset/:id', (p, body) =>
  updateWithHistory('asset', p.id, body, ['title', 'tags', 'note', 'status']));
route('DELETE', '/api/asset/:id', p => { // ẩn, KHÔNG chạm file gốc
  run("UPDATE asset SET status='removed', updated_at=datetime('now') WHERE id=?", p.id);
  return { removed: true, note: 'File gốc trên đĩa KHÔNG bị xoá' };
});
route('POST', '/api/pool/:id/scan', p => syncPool(p.id)); // thêm file mới + đánh dấu file mất (30/09)
route('GET', '/api/pool/:id/audit', p => { // soát kho: file mất / trùng md5 — soát xong CẬP NHẬT DB luôn (30/09)
  const sync = markMissing(p.id);
  const missing = all("SELECT id, file_path FROM asset WHERE pool_id=? AND status='missing'", p.id);
  const dupes = all(`SELECT md5, COUNT(*) n, GROUP_CONCAT(file_path, ' | ') files
    FROM asset WHERE pool_id=? AND md5 IS NOT NULL AND status='active' GROUP BY md5 HAVING n>1`, p.id);
  return { missing, dupes, sync };
});

// ===== Text pools: chữ thumbnail + SEO (yêu cầu #4) =====
// 05/10: mỗi playlist một kho SEO riêng — kho kèm danh sách playlist đang dùng
route('GET', '/api/channel/:id/textpool', p => all(`SELECT tp.*,
    (SELECT GROUP_CONCAT(pl.name, ' · ') FROM playlist pl WHERE pl.text_pool_id=tp.id AND pl.archived=0) AS used_by,
    (SELECT COUNT(*) FROM playlist pl WHERE pl.text_pool_id=tp.id AND pl.archived=0) AS used_count
  FROM text_pool tp WHERE tp.channel_id=? ORDER BY tp.id`, p.id));
// 05/10: tạo kho SEO mới (trang Kho chữ & SEO). Thư mục chưa có thì tạo.
route('POST', '/api/textpool', (p, body) => {
  const id = String(body.id ?? '').trim(), ch = body.channel_id;
  if (!/^[a-z0-9_][a-z0-9_-]{1,40}$/.test(id)) throw new Error('Mã kho: chữ thường, số, gạch ngang/gạch dưới (2–41 ký tự)');
  if (!get('SELECT 1 FROM channel WHERE id=?', ch)) throw new Error('Không có kênh ' + ch);
  if (get('SELECT 1 FROM text_pool WHERE id=?', id)) throw new Error('Đã có kho SEO mã ' + id);
  const dir = String(body.root_dir ?? '').trim() || null;
  if (dir) fs.mkdirSync(dir, { recursive: true });
  run('INSERT INTO text_pool (id,channel_id,name,root_dir) VALUES (?,?,?,?)', id, ch, String(body.name ?? '').trim() || id, dir);
  return { ...get('SELECT * FROM text_pool WHERE id=?', id), ...(dir ? { scan: syncTextPool(id) } : {}) };
});
// 02/10: trỏ kho SEO tới thư mục file + quét
route('PUT', '/api/textpool/:id/dir', (p, body) => {
  const dir = String(body.root_dir ?? '').trim();
  if (dir && !fs.existsSync(dir)) throw new Error('Thư mục không tồn tại: ' + dir);
  run('UPDATE text_pool SET root_dir=? WHERE id=?', dir || null, p.id);
  return dir ? syncTextPool(p.id) : { root_dir: null };
});
route('POST', '/api/textpool/:id/scan', p => syncTextPool(p.id));
route('GET', '/api/textpool/:id', p => get('SELECT * FROM text_pool WHERE id=?', p.id));
route('GET', '/api/textpool/:id/thumbnail-text', p => all(
  "SELECT * FROM thumbnail_text WHERE pool_id=? AND status='active' ORDER BY used_count, id", p.id));
route('POST', '/api/textpool/:id/thumbnail-text', (p, body) => {
  if (Array.isArray(body.items)) { // dán nhiều dòng
    tx(() => { for (const it of body.items) run('INSERT INTO thumbnail_text (pool_id,line1,line2,sub_line) VALUES (?,?,?,?)', p.id, it.line1, it.line2 ?? null, it.sub_line ?? null); });
    return { added: body.items.length };
  }
  const r = run('INSERT INTO thumbnail_text (pool_id,line1,line2,sub_line) VALUES (?,?,?,?)', p.id, body.line1, body.line2 ?? null, body.sub_line ?? null);
  return get('SELECT * FROM thumbnail_text WHERE id=?', r.lastInsertRowid);
});
route('PUT', '/api/thumbnail-text/:id', (p, body) =>
  updateWithHistory('thumbnail_text', p.id, body, ['line1', 'line2', 'sub_line', 'status']));
route('DELETE', '/api/thumbnail-text/:id', p => { run("UPDATE thumbnail_text SET status='removed' WHERE id=?", p.id); return { removed: true }; });

route('GET', '/api/textpool/:id/seo', (p, body, q) => all(
  "SELECT * FROM seo_item WHERE pool_id=? AND kind=? AND status='active' ORDER BY used_count, id LIMIT 1000", p.id, q.get('kind') ?? 'title'));
route('POST', '/api/textpool/:id/seo', (p, body) => {
  const items = Array.isArray(body.items) ? body.items : [body];
  tx(() => { for (const it of items) run('INSERT INTO seo_item (pool_id,kind,content) VALUES (?,?,?)', p.id, it.kind, it.content); });
  return { added: items.length };
});
route('PUT', '/api/seo/:id', (p, body) => updateWithHistory('seo_item', p.id, body, ['content', 'status']));
route('DELETE', '/api/seo/:id', p => { run("UPDATE seo_item SET status='removed' WHERE id=?", p.id); return { removed: true }; });

// ===== Plan (N2: xem kế hoạch TRƯỚC khi chạy) =====
function assetsForPlaylist(playlistId) {
  const rows = all(`SELECT a.*, ap.kind AS pool_kind FROM playlist_pool pp
    JOIN asset_pool ap ON ap.id=pp.pool_id AND ap.archived=0
    JOIN asset a ON a.pool_id=ap.id AND a.status='active'
    WHERE pp.playlist_id=?`, playlistId);
  const by = k => rows.filter(r => r.pool_kind === k);
  return { hooks: by('hook'), stories: by('story'), outros: by('outro'), shots: by('shot'), musics: by('music') };
}
function usedIdsFor(playlistId, scope) {
  const rows = scope === 'channel'
    ? all(`SELECT DISTINCT u.asset_id FROM usage_log u JOIN playlist p ON p.id=u.playlist_id
           WHERE p.channel_id=(SELECT channel_id FROM playlist WHERE id=?) AND u.asset_id IS NOT NULL`, playlistId)
    : all('SELECT DISTINCT asset_id FROM usage_log WHERE playlist_id=? AND asset_id IS NOT NULL', playlistId);
  return new Set(rows.map(r => r.asset_id));
}
route('POST', '/api/playlist/:id/plan', (p, body) => {
  const pl = get('SELECT * FROM playlist WHERE id=?', p.id);
  if (!pl) throw new Error('Không có playlist ' + p.id);
  const recipe = get('SELECT * FROM recipe WHERE id=?', pl.recipe_id);
  recipe.body_spec = JSON.parse(recipe.body_spec); recipe.tail_spec = JSON.parse(recipe.tail_spec);
  const assets = assetsForPlaylist(p.id);
  const usedIds = usedIdsFor(p.id, pl.dedupe_scope);
  const gate = checkResources(recipe, assets, { usedIds });
  const sys = checkSystem(recipe.total_seconds ?? 3600, Object.fromEntries(all('SELECT name,path FROM tool').map(t => [t.name, t.path])));
  if (!gate.ok || !sys.ok) return { ok: false, gate, sys };
  const seed = body.seed ?? Math.floor(Math.random() * 1e9);
  const result = buildPlan(recipe, assets, { seed, usedIds });
  return { ...result, gate, sys, seed };
});

// ===== Jobs =====
route('GET', '/api/job', () => all('SELECT id,playlist_id,status,created_at,started_at,finished_at,video_path,error FROM job ORDER BY id DESC LIMIT 100'));
route('GET', '/api/job/:id', p => {
  const j = get('SELECT * FROM job WHERE id=?', p.id);
  if (j) j.steps = all('SELECT * FROM job_step WHERE job_id=? ORDER BY id', p.id);
  return j;
});
route('POST', '/api/job', (p, body) => {
  // B3: "Xếp hàng sản xuất" = chuỗi 1 kênh, đi qua CÙNG bộ giám sát (một kênh một lúc)
  if (!body.playlist_id) throw new Error('Cần playlist_id');
  const pl = get('SELECT name FROM playlist WHERE id=?', body.playlist_id);
  return createChain({ name: 'Sản xuất lẻ: ' + (pl?.name ?? body.playlist_id), playlistIds: [body.playlist_id] });
});

// ===== Chuỗi nhiều playlist (B3) =====
const withVn = c => c && ({ ...c, created_vn: vnFromSql(c.created_at), started_vn: vnFromSql(c.started_at), finished_vn: vnFromSql(c.finished_at),
  items: (c.items ?? []).map(i => ({ ...i, name: get('SELECT p.name || \' · \' || ch.name AS n FROM playlist p JOIN channel ch ON ch.id=p.channel_id WHERE p.id=?', i.playlist_id)?.n ?? i.playlist_id,
    started_vn: vnFromSql(i.started_at), finished_vn: vnFromSql(i.finished_at), last_progress_vn: vnFromSql(i.last_progress_at), log_name: i.log_file ? path.basename(i.log_file) : null })),
  log_name: c.log_file ? path.basename(c.log_file) : null });
route('GET', '/api/chain', () => listChains(20).map(withVn));
route('GET', '/api/chain/:id', p => withVn(getChain(+p.id)));
route('POST', '/api/chain', (p, body) => withVn(createChain({ name: body.name, playlistIds: body.playlist_ids })));
route('POST', '/api/chain/:id/pause', p => withVn(pauseChain(+p.id)));
route('POST', '/api/chain/:id/resume', p => withVn(resumeChain(+p.id)));
route('POST', '/api/chain/:id/cancel', p => withVn(cancelChain(+p.id)));
route('GET', '/api/schedule', () => all('SELECT * FROM schedule ORDER BY time_vn').map(s => ({ ...s, playlist_ids: JSON.parse(s.playlist_ids) })));
route('POST', '/api/schedule', (p, body) => saveSchedule(body));
route('PUT', '/api/schedule/:id', (p, body) => saveSchedule(body, +p.id));
route('DELETE', '/api/schedule/:id', p => { run('DELETE FROM schedule WHERE id=?', +p.id); return { deleted: true }; });
route('GET', '/api/now', () => ({ vn: vnStamp() }));

// ===== LƯU TRỮ (30/09: thay Xoá) — không mất dữ liệu, khôi phục được =====
const ACTIVE_CHAIN = `SELECT ci.playlist_id FROM chain_item ci JOIN chain c ON c.id=ci.chain_id
  WHERE ci.status IN ('pending','running') AND c.status IN ('queued','running','paused')`;
const busyPlaylists = ids => { const s = new Set(all(ACTIVE_CHAIN).map(r => r.playlist_id)); return ids.filter(i => s.has(i)); };
function blockIfBusy(ids, what) {
  const b = busyPlaylists(ids);
  if (b.length) throw new Error(`${what} đang có trong chuỗi chưa chạy xong (${b.join(', ')}) — huỷ/chờ chuỗi xong rồi lưu trữ`);
}
registerStyleRoutes(route, { blockIfBusy }); // 08/10: kiểu chữ + xoá hẳn
route('POST', '/api/channel/:id/archive', p => {
  const ch = get('SELECT * FROM channel WHERE id=?', p.id); if (!ch) throw new Error('Không có kênh ' + p.id);
  const pls = all('SELECT id FROM playlist WHERE channel_id=? AND archived=0', p.id).map(r => r.id);
  blockIfBusy(pls, 'Kênh');
  tx(() => {
    logConfigChange('channel', p.id, ch, { ...ch, archived: 1 });
    run("UPDATE channel SET archived=1, archived_at=datetime('now') WHERE id=?", p.id);
    run("UPDATE playlist SET archived=1, archived_with_channel=1, archived_at=datetime('now') WHERE channel_id=? AND archived=0", p.id);
  });
  return { archived: true, playlists: pls };
});
route('POST', '/api/channel/:id/restore', p => {
  tx(() => {
    run('UPDATE channel SET archived=0, archived_at=NULL WHERE id=?', p.id);
    run('UPDATE playlist SET archived=0, archived_with_channel=0, archived_at=NULL WHERE channel_id=? AND archived_with_channel=1', p.id);
  });
  return { restored: true };
});
route('POST', '/api/playlist/:id/archive', p => {
  const pl = get('SELECT * FROM playlist WHERE id=?', p.id); if (!pl) throw new Error('Không có playlist ' + p.id);
  blockIfBusy([p.id], 'Playlist');
  logConfigChange('playlist', p.id, pl, { ...pl, archived: 1 });
  run("UPDATE playlist SET archived=1, archived_with_channel=0, archived_at=datetime('now') WHERE id=?", p.id);
  return { archived: true };
});
route('POST', '/api/playlist/:id/restore', p => {
  const pl = get('SELECT * FROM playlist WHERE id=?', p.id); if (!pl) throw new Error('Không có playlist ' + p.id);
  if (get('SELECT archived FROM channel WHERE id=?', pl.channel_id)?.archived) throw new Error('Kênh của playlist đang lưu trữ — khôi phục kênh trước');
  run('UPDATE playlist SET archived=0, archived_with_channel=0, archived_at=NULL WHERE id=?', p.id);
  return { restored: true };
});
// Kho: nếu gỡ kho làm playlist hết kho cùng loại → trả danh sách cảnh báo, cần confirm:true mới lưu trữ
route('POST', '/api/pool/:id/archive', (p, body) => {
  const pool = get('SELECT * FROM asset_pool WHERE id=?', p.id); if (!pool) throw new Error('Không có kho ' + p.id);
  const users = all(`SELECT pl.id, pl.name FROM playlist_pool pp JOIN playlist pl ON pl.id=pp.playlist_id
    WHERE pp.pool_id=? AND pl.archived=0`, p.id);
  blockIfBusy(users.map(u => u.id), 'Kho');
  const orphan = users.filter(u => !get(`SELECT 1 FROM playlist_pool pp JOIN asset_pool ap ON ap.id=pp.pool_id
    WHERE pp.playlist_id=? AND ap.kind=? AND ap.id<>? AND ap.archived=0`, u.id, pool.kind, p.id));
  if (orphan.length && !body?.confirm) return { archived: false, need_confirm: true, orphan, kind: pool.kind };
  logConfigChange('asset_pool', p.id, pool, { ...pool, archived: 1 });
  run("UPDATE asset_pool SET archived=1, archived_at=datetime('now') WHERE id=?", p.id);
  return { archived: true, orphan };
});
route('POST', '/api/pool/:id/restore', p => { run('UPDATE asset_pool SET archived=0, archived_at=NULL WHERE id=?', p.id); return { restored: true }; });
route('GET', '/api/archive', () => ({
  channels: all(`SELECT c.*, (SELECT COUNT(*) FROM playlist p WHERE p.channel_id=c.id AND p.archived_with_channel=1) AS playlist_count
    FROM channel c WHERE c.archived=1 ORDER BY c.archived_at DESC`),
  playlists: all(`SELECT p.*, c.name AS channel_name, c.archived AS channel_archived FROM playlist p JOIN channel c ON c.id=p.channel_id
    WHERE p.archived=1 AND p.archived_with_channel=0 ORDER BY p.archived_at DESC`),
  pools: all(`SELECT ap.*, (SELECT COUNT(*) FROM asset a WHERE a.pool_id=ap.id AND a.status='active') AS asset_count
    FROM asset_pool ap WHERE ap.archived=1 ORDER BY ap.archived_at DESC`),
  assets: all(`SELECT a.id, a.title, a.file_path, a.status, a.updated_at, ap.name AS pool_name, ap.kind
    FROM asset a JOIN asset_pool ap ON ap.id=a.pool_id WHERE a.status IN ('hidden','removed') ORDER BY a.updated_at DESC LIMIT 1000`),
}));
route('POST', '/api/asset/:id/restore', p => {
  const a = get('SELECT * FROM asset WHERE id=?', p.id); if (!a) throw new Error('Không có mục ' + p.id);
  if (!fs.existsSync(a.file_path)) throw new Error('File không còn trên ổ — không khôi phục được: ' + a.file_path);
  run("UPDATE asset SET status='active', updated_at=datetime('now') WHERE id=?", p.id);
  return { restored: true };
});

// ===== Đăng nhập kênh (30/09): đăng nhập lại khi hết hạn + thêm kênh mới =====
route('POST', '/api/oauth/start', (p, body) => startAuth({ channelId: body.channel_id ?? null, newId: body.new_id ?? null }));
route('POST', '/api/oauth/finish', (p, body) => finishAuth({ pasted: body.pasted }));
route('POST', '/api/channel/check-tokens', () => checkAllTokens());

// ===== Nhật ký (file text trong logs/, giữ 30 ngày) =====
const safeLog = name => { const f = path.join(LOG_DIR, path.basename(name)); if (!f.startsWith(LOG_DIR) || !f.endsWith('.log')) throw new Error('Tên log không hợp lệ'); return f; };
route('GET', '/api/logs', () => !fs.existsSync(LOG_DIR) ? [] : fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log'))
  .map(f => { const st = fs.statSync(path.join(LOG_DIR, f)); return { name: f, size: st.size, mtime: st.mtimeMs, mtime_vn: vnStamp(new Date(st.mtimeMs)) }; })
  .sort((a, b) => b.mtime - a.mtime));
route('GET', '/api/logs/:name', p => { const f = safeLog(p.name); return fs.existsSync(f) ? { name: p.name, text: fs.readFileSync(f, 'utf8').slice(-400000) } : null; });

// ===== System =====
route('GET', '/api/system', () => {
  const tools = all('SELECT * FROM tool');
  for (const t of tools) t.exists = t.path === 'python' ? true : fs.existsSync(t.path);
  let disk = null;
  try { const s = fs.statfsSync(diskRoot()); disk = +(s.bavail * s.bsize / 1073741824).toFixed(2); } catch {}
  return { disk_free_gb: disk, tools, db_counts: Object.fromEntries(['channel', 'playlist', 'recipe', 'asset', 'job'].map(t => [t, get(`SELECT COUNT(*) n FROM ${t}`).n])) };
});

// ---------- dispatch ----------
// Chống CSRF (app chưa có auth): chỉ nhận Host đúng của mình; Origin lạ thì từ chối.
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
if (TAILSCALE_IP) ALLOWED_HOSTS.add(`${TAILSCALE_IP}:${PORT}`);
// Tải 1 file lên kho: body = nội dung file (nhị phân), tên file ở header x-filename (encodeURIComponent).
// Ghi .part rồi đổi tên; KHÔNG ghi đè file đã có. Sau khi tải xong, giao diện gọi Quét lại để nhập vào DB.
function handleUpload(poolId, req) {
  const pool = get('SELECT * FROM asset_pool WHERE id=?', poolId);
  if (!pool) throw new Error('Không có kho ' + poolId);
  const name = path.basename(decodeURIComponent(req.headers['x-filename'] ?? ''));
  if (!name || name.startsWith('.')) throw new Error('Thiếu tên file');
  const ext = path.extname(name).toLowerCase();
  const ok = [...poolExts(pool.kind), ...(VOICE_KINDS.includes(pool.kind) ? ['.srt', '.ass'] : [])];
  if (!ok.includes(ext)) throw new Error(`Kho ${pool.kind} không nhận đuôi ${ext}`);
  const dest = path.join(pool.root_dir, name);
  if (fs.existsSync(dest)) throw new Error('Đã có file trùng tên trong kho: ' + name);
  fs.mkdirSync(pool.root_dir, { recursive: true });
  const part = dest + '.part';
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(part);
    let bytes = 0;
    req.on('data', c => { bytes += c.length; });
    req.pipe(ws);
    ws.on('finish', () => { try { fs.renameSync(part, dest); resolve({ saved: name, bytes }); } catch (e) { reject(e); } });
    const fail = e => { try { fs.rmSync(part, { force: true }); } catch {} reject(e); };
    ws.on('error', fail); req.on('error', fail);
    req.on('aborted', () => fail(new Error('Tải lên bị ngắt')));
  });
}
function requestAllowed(req) {
  if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) return false;
  const origin = req.headers.origin;
  if (origin) {
    try { if (!ALLOWED_HOSTS.has(new URL(origin).host)) return false; }
    catch { return false; }
  }
  return true;
}
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (!requestAllowed(req)) return send(res, 403, { error: 'forbidden host/origin' });
    const dl = req.method === 'GET' && u.pathname.match(/^\/api\/logs\/([^/]+)\/download$/);
    if (dl) {
      const f = safeLog(decodeURIComponent(dl[1]));
      if (!fs.existsSync(f)) return send(res, 404, { error: 'không có log' });
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="${path.basename(f)}"`, 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(f));
    }
    const up = req.method === 'POST' && u.pathname.match(/^\/api\/pool\/([^/]+)\/upload$/);
    if (up) return send(res, 200, await handleUpload(decodeURIComponent(up[1]), req));
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = u.pathname.match(r.re);
      if (!m) continue;
      const params = {}; r.names.forEach((n, i) => params[n] = decodeURIComponent(m[i + 1]));
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : null;
      const out = await r.handler(params, body, u.searchParams); // có route async (đăng nhập kênh)
      return send(res, out == null ? 404 : 200, out ?? { error: 'not found' });
    }
    // static
    let fp = path.join(PUBLIC, u.pathname === '/' ? 'index.html' : u.pathname);
    if (!fp.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });
    if (fs.existsSync(fp) && fs.statSync(fp).isFile())
      return send(res, 200, fs.readFileSync(fp), MIME[path.extname(fp).toLowerCase()] ?? 'application/octet-stream');
    return send(res, 404, { error: 'not found: ' + u.pathname });
  } catch (e) {
    return send(res, 400, { error: String(e.message) });
  }
});
// Phòng thủ 2 lớp: bind HẸP đúng loopback + IP Tailscale (không 0.0.0.0), firewall là lớp phụ.
server.listen(PORT, '127.0.0.1', () => { console.log(`YouTube Content Factory http://127.0.0.1:${PORT}`); startSupervisor(); });
// Tailscale có thể lên MUỘN hơn server (boot): dò lại mỗi 30s tới khi bind được.
function findTailscaleIp() {
  return Object.values(os.networkInterfaces()).flat()
    .find(a => a && a.family === 'IPv4' && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address))?.address ?? null;
}
function bindTailscale() {
  const ip = findTailscaleIp();
  if (!ip) { setTimeout(bindTailscale, 30_000); return; }
  ALLOWED_HOSTS.add(`${ip}:${PORT}`);
  const ts = http.createServer(server.listeners('request')[0]);
  ts.on('error', e => { console.error('tailscale bind failed, retry 30s:', e.message); setTimeout(bindTailscale, 30_000); });
  ts.listen(PORT, ip, () => console.log(`  + Tailscale http://${ip}:${PORT}`));
}
bindTailscale();
