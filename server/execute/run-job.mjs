// run-job.mjs — TIẾN TRÌNH RIÊNG cho MỘT video trong chuỗi (bộ giám sát queue.mjs sinh ra).
//   node run-job.mjs --item <chain_item_id> [--no-upload]
// Trình tự: lập kế hoạch → dựng → kiểm tra → thumbnail → upload (thử lại 2) → hẹn phụ đề → ghi đã dùng → DỌN.
// Thành công hay lỗi đều DỌN SẠCH thư mục làm việc trước khi thoát (anh Vũ chốt 30/09).
// Ghi tiến độ (stage) vào chain_item để giao diện + bộ giám sát theo dõi; log ra file text giờ VN.
import fs from 'node:fs';
import { config, diskRoot } from '../config.mjs';
import path from 'node:path';
import { get, all, run, openDb } from '../db/db.mjs';
import { buildPlan } from '../recipe/plan.mjs';
import { syncPool } from '../recipe/pool-sync.mjs';
import { syncTextPool } from '../recipe/seo-sync.mjs';
import { checkResources, checkSystem } from '../recipe/validate.mjs';
import { executeJob } from './executor.mjs';
import { verifyVideo } from './verify.mjs';
import { recordUsage } from './usage.mjs';
import { pickTexts, markTextsUsed, makeThumbnail, uploadVideo, scheduleCaption } from './upload.mjs';
import { appendLog } from './notify.mjs';

export const OUT_ROOT = config.workDir; // config.json → workDir
const arg = n => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : null; };
const itemId = Number(arg('item'));
const noUpload = process.argv.includes('--no-upload');
openDb().exec('PRAGMA busy_timeout=15000'); // server cũng đang ghi DB → chờ khoá thay vì lỗi
const item = get('SELECT * FROM chain_item WHERE id=?', itemId);
if (!item) { console.error('Không có chain_item ' + itemId); process.exit(2); }
const LOG = item.log_file;
const log = m => { appendLog(LOG, m); };
const stage = s => { run("UPDATE chain_item SET stage=?, last_progress_at=datetime('now') WHERE id=?", s, itemId); log('▶ ' + s); };

let outDir = null, jobId = null;
function cleanup() {
  if (outDir && fs.existsSync(outDir)) {
    let bytes = 0;
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else try { bytes += fs.statSync(p).size; } catch {} } };
    try { walk(outDir); } catch {}
    fs.rmSync(outDir, { recursive: true, force: true });
    log(`Dọn file tạm: xoá ${outDir} (${(bytes / 1073741824).toFixed(2)} GB)`);
  }
}

async function main() {
  run("UPDATE chain_item SET pid=?, status='running', started_at=COALESCE(started_at, datetime('now')) WHERE id=?", process.pid, itemId);
  const pl = get('SELECT * FROM playlist WHERE id=?', item.playlist_id);
  const ch = get('SELECT * FROM channel WHERE id=?', pl.channel_id);
  log(`===== ${ch.name} · ${pl.name} (${pl.id}) =====`);

  // 0. Kiểm đăng nhập kênh TRƯỚC khi dựng (30/09: dựng 11 phút rồi mới biết mã đăng nhập PQTA đã hỏng)
  if (!noUpload) {
    stage('Kiểm đăng nhập kênh');
    if (!ch.secrets_file || !fs.existsSync(ch.secrets_file)) throw new Error('Kênh thiếu file đăng nhập: ' + ch.secrets_file);
    const sc = JSON.parse(fs.readFileSync(ch.secrets_file, 'utf8').replace(/^\uFEFF/, ''));
    const tr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
      client_id: sc.client_id || sc.YT_CLIENT_ID, client_secret: sc.client_secret || sc.YT_CLIENT_SECRET,
      refresh_token: sc.refresh_token || sc.YT_REFRESH_TOKEN, grant_type: 'refresh_token' }) }).then(r => r.json()).catch(e => ({ error: e.message }));
    if (!tr.access_token) {
      run("UPDATE channel SET token_status='expired', token_checked_at=datetime('now') WHERE id=?", ch.id);
      throw new Error(`Mã đăng nhập YouTube của kênh ${ch.name} đã hết hạn/bị thu hồi (${tr.error}) — cần đăng nhập lại kênh. KHÔNG dựng để khỏi phí công.`);
    }
    run("UPDATE channel SET token_status='valid', token_checked_at=datetime('now') WHERE id=?", ch.id);
  }

  // 0b. Quét lại kho (30/09): file mới → thêm, file mất → không bốc nữa. Trước đây bốc trúng nhạc đã mất → video câm.
  stage('Quét lại kho');
  for (const pp of all('SELECT pool_id FROM playlist_pool WHERE playlist_id=?', pl.id)) {
    const r = syncPool(pp.pool_id);
    log(`Kho ${pp.pool_id}: còn ${r.active} file dùng được${r.added ? ' · thêm ' + r.added : ''}${r.missing ? ' · MẤT ' + r.missing : ''}${r.restored ? ' · có lại ' + r.restored : ''}${r.warning ? ' · ⚠ ' + r.warning : ''}`);
  }

  if (pl.text_pool_id) { // 02/10: kho SEO trỏ thư mục file → đồng bộ trước khi bốc
    try { const s = syncTextPool(pl.text_pool_id); if (!s.skipped) log(`Kho SEO ${pl.text_pool_id}: tiêu đề ${s.stat.title.active} · mô tả ${s.stat.description.active} · tag ${s.stat.tags.active} · chữ thumb ${s.stat.thumb.active} · phần kết ${s.stat.ending.active}${s.errors.length ? ' · ⚠ ' + s.errors.length + ' lỗi: ' + s.errors.slice(0, 3).join(' | ') : ''}`); }
    catch (e) { log('⚠ Quét kho SEO lỗi: ' + e.message); }
  }

  // 1. Kế hoạch (y như nút Lập kế hoạch trên web)
  stage('Lập kế hoạch');
  const recipe = get('SELECT * FROM recipe WHERE id=?', pl.recipe_id);
  recipe.body_spec = JSON.parse(recipe.body_spec); recipe.tail_spec = JSON.parse(recipe.tail_spec);
  const rows = all(`SELECT a.*, ap.kind AS pool_kind FROM playlist_pool pp JOIN asset_pool ap ON ap.id=pp.pool_id AND ap.archived=0
    JOIN asset a ON a.pool_id=ap.id AND a.status='active' WHERE pp.playlist_id=?`, pl.id);
  const by = k => rows.filter(r => r.pool_kind === k);
  const assets = { hooks: by('hook'), stories: by('story'), outros: by('outro'), shots: by('shot'), musics: by('music') };
  const used = pl.dedupe_scope === 'channel'
    ? all(`SELECT DISTINCT u.asset_id FROM usage_log u JOIN playlist p ON p.id=u.playlist_id WHERE p.channel_id=? AND u.asset_id IS NOT NULL`, pl.channel_id)
    : all('SELECT DISTINCT asset_id FROM usage_log WHERE playlist_id=? AND asset_id IS NOT NULL', pl.id);
  const usedIds = new Set(used.map(r => r.asset_id));
  const gate = checkResources(recipe, assets, { usedIds });
  const sys = checkSystem(recipe.total_seconds ?? 3600, Object.fromEntries(all('SELECT name,path FROM tool').map(t => [t.name, t.path])));
  if (!gate.ok || !sys.ok) throw new Error('Không đủ điều kiện dựng: ' + JSON.stringify({ gate: gate.errors ?? gate, sys: sys.errors ?? sys }).slice(0, 600));
  const seed = Math.floor(Math.random() * 1e9);
  const r = buildPlan(recipe, assets, { seed, usedIds });
  if (!r.ok) throw new Error('Kế hoạch lỗi: ' + r.errors.join(' · '));
  const plan = { ...r.plan, subtitle_style: pl.subtitle_style };
  for (const w of r.warnings) log('⚠ ' + w);
  log(`Kế hoạch: tổng ${(plan.total_s / 60).toFixed(1)}' · giọng hết ${(plan.voice_end_s / 60).toFixed(1)}' · ${plan.picked.stories.length} truyện · seed ${seed}`);
  // Chốt chặn cuối: mọi file trong kế hoạch phải còn trên ổ (file có thể bị xoá giữa lúc quét và lúc dựng)
  const planFiles = [...(plan.compose.voiceover_files ?? []), plan.compose.music, ...(plan.compose.shots_base ?? [])].filter(Boolean).map(f => typeof f === 'string' ? f : f.file ?? f.file_path);
  const lost = planFiles.filter(f => f && !fs.existsSync(f));
  if (lost.length) throw new Error(`Kế hoạch có ${lost.length} file không còn trên ổ — KHÔNG dựng: ${lost.slice(0, 3).join(' | ')}`);
  jobId = run("INSERT INTO job (playlist_id,status,plan_json) VALUES (?, 'queued', ?)", pl.id, JSON.stringify(plan)).lastInsertRowid;
  run('UPDATE chain_item SET job_id=? WHERE id=?', jobId, itemId);
  outDir = path.join(OUT_ROOT, `${pl.id}-job${jobId}`);

  // 2. Dựng
  stage('Dựng video');
  const t0 = Date.now();
  const res = executeJob(jobId, { outRoot: OUT_ROOT });
  log(`Dựng xong sau ${((Date.now() - t0) / 60000).toFixed(1)} phút → ${res.video}`);

  // 3. Kiểm tra bằng số (thời lượng, fade, outro còn tiếng, phụ đề)
  stage('Kiểm tra thành phẩm');
  const v = verifyVideo(res.video, plan);
  for (const c of v.checks) log(`  ${c.ok ? 'ĐẠT ' : 'TRƯỢT'} ${c.name}: ${c.actual} (chuẩn ${c.expected})`);
  if (!v.ok) throw new Error('Thành phẩm không đạt kiểm tra: ' + v.checks.filter(c => !c.ok).map(c => c.name).join(', '));

  if (noUpload) { run("UPDATE job SET status='done', finished_at=datetime('now') WHERE id=?", jobId); log('--no-upload: bỏ qua upload (chạy thử)'); return { videoId: null }; }

  // 4. Chữ SEO + thumbnail
  stage('Tạo thumbnail + SEO');
  const picks = pickTexts(pl, plan);
  const ffmpeg = (config.ffmpeg || get("SELECT path FROM tool WHERE name='ffmpeg'")?.path || 'ffmpeg');
  const thumb = makeThumbnail({ plan, offsetS: pl.thumbnail_extract_offset_s, texts: picks.thumb, outPath: path.join(outDir, 'thumb.jpg'), ffmpeg });
  const descFile = path.join(outDir, 'description.txt');
  fs.writeFileSync(descFile, picks.description, 'utf8');
  log(`Tiêu đề: ${picks.title}`);
  log(`Thumbnail: "${picks.thumb.line1} / ${picks.thumb.line2}" · khung từ ${path.basename(thumb.source)} @${thumb.at_s.toFixed(1)}s`);

  // 5. Upload (thử lại tối đa 2 lần)
  stage('Upload YouTube');
  run("UPDATE job SET status='uploading' WHERE id=?", jobId);
  if (!ch.secrets_file || !fs.existsSync(ch.secrets_file)) throw new Error('Kênh thiếu file đăng nhập: ' + ch.secrets_file);
  const up = await uploadVideo({ secretsFile: ch.secrets_file, file: res.video, title: picks.title, descFile, tags: picks.tags,
    privacy: pl.privacy, thumb: thumb.path, youtubePlaylist: pl.youtube_playlist_id, log });
  log(`Upload xong: https://youtu.be/${up.videoId} (lần ${up.attempt}) · thumbnail: ${up.thumbnail} · playlist: ${up.playlist}`);
  run("UPDATE job SET status='done', youtube_video_id=?, finished_at=datetime('now') WHERE id=?", up.videoId, jobId);
  run('UPDATE chain_item SET youtube_video_id=? WHERE id=?', up.videoId, itemId);

  // 6. Ghi đã dùng (chỉ sau upload thành công) + hẹn phụ đề
  const u = recordUsage(jobId); markTextsUsed(picks);
  log(`Ghi đã dùng: ${u.recorded ?? 0} tài nguyên + tiêu đề/mô tả/chữ thumbnail`);
  stage('Hẹn đăng phụ đề');
  const srt = path.join(outDir, path.basename(res.video).replace(/\.mp4$/, '.srt'));
  try { scheduleCaption({ videoId: up.videoId, srtSrc: srt, secretsFile: ch.secrets_file, delayHours: pl.caption_delay_hours ?? 6, log }); }
  catch (e) { log('⚠ KHÔNG hẹn được phụ đề (video đã lên, cần đăng phụ đề tay): ' + e.message); }
  return { videoId: up.videoId };
}

let code = 0;
try {
  const out = await main();
  run("UPDATE chain_item SET status='done', stage='Xong', finished_at=datetime('now') WHERE id=?", itemId);
  log(`✅ HOÀN TẤT${out.videoId ? ' · https://youtu.be/' + out.videoId : ''}`);
} catch (e) {
  code = 1;
  log('❌ LỖI: ' + (e.stack || e.message));
  run("UPDATE chain_item SET status='failed', error=?, finished_at=datetime('now') WHERE id=?", String(e.message).slice(0, 1000), itemId);
  if (jobId) run("UPDATE job SET status='failed', error=?, finished_at=datetime('now') WHERE id=? AND status NOT IN ('done')", String(e.message).slice(0, 1000), jobId);
} finally {
  stage('Dọn file tạm');
  try { cleanup(); } catch (e) { log('⚠ Dọn lỗi: ' + e.message); }
  run("UPDATE chain_item SET pid=NULL, stage=? WHERE id=?", code ? 'Lỗi — đã dọn' : 'Xong — đã dọn', itemId);
}
process.exit(code);
