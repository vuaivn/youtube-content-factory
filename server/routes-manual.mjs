// routes-manual.mjs - API video thủ công (11/2026, giai đoạn 1: chỉ backend).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { get, all, run } from './db/db.mjs';
import { ensureManualPlaylist } from './migrate/m7-manual.mjs';
import { listPresets, savePreset, deletePreset, validateManualSub, aspectSize } from './recipe/manual-style.mjs';
import { previewFrame } from './execute/manual-render.mjs';
import { imagesOf, manualOutDir } from './recipe/manual-plan.mjs';
export { imagesOf, manualOutDir };
import { tick } from './execute/queue.mjs';
import { uploadVideo, scheduleCaption } from './execute/upload.mjs';
import { appendLog, logPath, vnFileStamp } from './execute/notify.mjs';


/** Cây thư mục của 1 kho (đường dẫn tương đối so với root_dir). */
export function poolTree(poolId) {
  const pool = get('SELECT * FROM asset_pool WHERE id=?', poolId);
  if (!pool) return null;
  const root = { name: pool.name, path: '', children: [], files: [], imageCount: 0 };
  const node = rel => {
    let n = root;
    if (!rel) return n;
    let acc = '';
    for (const part of rel.split(/[\\/]/)) {
      acc = acc ? acc + '/' + part : part;
      let c = n.children.find(x => x.name === part);
      if (!c) { c = { name: part, path: acc, children: [], files: [], imageCount: 0 }; n.children.push(c); }
      n = c;
    }
    return n;
  };
  const isImage = pool.kind === 'image';
  for (const a of all("SELECT id, file_path, title, duration_s, has_subtitle FROM asset WHERE pool_id=? AND status='active' ORDER BY file_path", poolId)) {
    const rel = path.relative(pool.root_dir, a.file_path);
    if (rel.startsWith('..')) continue;
    const n = node(path.dirname(rel) === '.' ? '' : path.dirname(rel));
    n.files.push({ id: a.id, name: path.basename(rel), title: a.title, duration_s: a.duration_s, has_subtitle: !!a.has_subtitle });
  }
  const count = n => { n.children.sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }));
    n.imageCount = (isImage ? n.files.length : 0) + n.children.reduce((s, c) => s + count(c), 0);
    n.durationTotal_s = n.files.reduce((s, f) => s + (f.duration_s || 0), 0) + n.children.reduce((s, c) => s + c.durationTotal_s, 0);
    return n.imageCount; };
  count(root);
  return { pool: { id: pool.id, kind: pool.kind, name: pool.name, root_dir: pool.root_dir }, tree: root };
}

export function createManualJob(b) {
  const ch = get('SELECT * FROM channel WHERE id=?', b.channelId);
  if (!ch) throw new Error('Không có kênh ' + b.channelId);
  if (!Array.isArray(b.voiceIds) || !b.voiceIds.length) throw new Error('Chưa chọn file giọng');
  for (const id of b.voiceIds) {
    const a = get("SELECT a.status, ap.kind FROM asset a JOIN asset_pool ap ON ap.id=a.pool_id WHERE a.id=?", Number(id));
    if (!a || a.status !== 'active') throw new Error('File giọng #' + id + ' không dùng được');
  }
  aspectSize(b.aspect ?? 'horizontal', b.quality ?? '1080');
  const subStyle = validateManualSub(b.subStyle);
  if (!b.backgroundVideo) { if (!imagesOf(b.imagePoolId, b.imageFolder).length) throw new Error('Thư mục ảnh không có ảnh nào'); }
  const m = b.meta ?? {};
  if (b.autoUpload && !String(m.title ?? '').trim()) throw new Error('Tự upload cần tiêu đề');
  if (m.privacy && !['private', 'unlisted', 'public'].includes(m.privacy)) throw new Error('privacy: private|unlisted|public');
  if (m.publishAt && isNaN(Date.parse(m.publishAt))) throw new Error('publishAt không hợp lệ (ISO 8601)');
  const meta = {
    voiceIds: b.voiceIds.map(Number), gap: b.gap ?? 0.5, imagePoolId: b.imagePoolId ?? null, imageFolder: b.imageFolder ?? '',
    backgroundVideo: b.backgroundVideo ?? null, secPerImage: Number(b.secPerImage ?? 8), order: b.order === 'sorted' ? 'sorted' : 'shuffle',
    aspect: b.aspect ?? 'horizontal', quality: String(b.quality ?? '1080'), subStyle, autoUpload: !!b.autoUpload, captionLang: b.captionLang ?? 'vi',
    meta: { title: String(m.title ?? '').slice(0, 100), description: String(m.description ?? ''), tags: Array.isArray(m.tags) ? m.tags.map(String) : [],
      youtubePlaylist: m.youtubePlaylist || null, privacy: m.privacy || 'private', publishAt: m.publishAt || null },
  };
  const plId = ensureManualPlaylist(ch.id);
  const jobId = run("INSERT INTO job (playlist_id, status, kind, meta_json) VALUES (?, 'queued', 'manual', ?)", plId, JSON.stringify(meta)).lastInsertRowid;
  const stamp = vnFileStamp();
  const chainLog = logPath(`chuoi-${stamp}.log`);
  const name = `Video thủ công #${jobId}${meta.meta.title ? ' - ' + meta.meta.title.slice(0, 60) : ''}`;
  const cid = run("INSERT INTO chain (name,source,status,log_file) VALUES (?, 'manual', 'queued', ?)", name, chainLog).lastInsertRowid;
  const itemId = run('INSERT INTO chain_item (chain_id,position,playlist_id,job_id,log_file) VALUES (?,1,?,?,?)', cid, plId, jobId, logPath(`job-chuoi${cid}-1-manual${jobId}.log`)).lastInsertRowid;
  appendLog(chainLog, `Tạo chuỗi #${cid}: video thủ công job #${jobId} (${ch.name})`);
  setTimeout(tick, 200);
  return { jobId: Number(jobId), chainId: Number(cid), itemId: Number(itemId) };
}

export function manualJobInfo(id) {
  const j = get("SELECT * FROM job WHERE id=? AND kind='manual'", id);
  if (!j) return null;
  const ci = get('SELECT id, chain_id, status, stage, error, log_file FROM chain_item WHERE job_id=? ORDER BY id DESC LIMIT 1', id);
  const plan = j.plan_json ? JSON.parse(j.plan_json) : null;
  return { id: j.id, status: j.status, error: j.error, video_path: j.video_path, youtube_video_id: j.youtube_video_id,
    meta: JSON.parse(j.meta_json || '{}'), result: plan, chain_item: ci, created_at: j.created_at, finished_at: j.finished_at,
    video_url: j.video_path ? `/api/manual-job/${j.id}/video` : null };
}

export function registerManualRoutes(route) {
  route('GET', '/api/pool/:id/tree', p => poolTree(p.id));
  route('GET', '/api/manual/presets', () => ({ presets: listPresets() }));
  route('POST', '/api/manual/presets', (p, body) => body?.delete ? deletePreset(body.delete) : savePreset(body ?? {}));
  route('POST', '/api/manual/preview-frame', (p, b) => {
    let image = null;
    if (b.imagePoolId) { const imgs = imagesOf(b.imagePoolId, b.imageFolder); image = imgs[Math.floor(Math.random() * imgs.length)] ?? null; }
    const png = previewFrame({ style: b.style, aspect: b.aspect, quality: b.quality, image, sampleText: b.sampleText, workDir: config.workDir });
    return { mime: 'image/png', dataUrl: 'data:image/png;base64,' + png.toString('base64'), image, bytes: png.length };
  });
  route('POST', '/api/manual-job', (p, b) => createManualJob(b ?? {}));
  route('GET', '/api/manual-job', () => all("SELECT id FROM job WHERE kind='manual' ORDER BY id DESC LIMIT 50").map(r => manualJobInfo(r.id)));
  route('GET', '/api/manual-job/:id', p => manualJobInfo(Number(p.id)));
  route('GET', '/api/manual/srt-sample/:id', p => { // câu phụ đề đầu tiên của file giọng (để xem trước khung hình)
    const a = get('SELECT file_path FROM asset WHERE id=?', Number(p.id));
    const srt = a && a.file_path.replace(/\.[^.\\/]+$/, '.srt');
    if (!srt || !fs.existsSync(srt)) return { text: '' };
    const m = fs.readFileSync(srt, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n\r?\n/).map(b => b.split(/\r?\n/)).find(l => l.length >= 3 && /-->/.test(l[1]));
    return { text: m ? m.slice(2).join('\n') : '' };
  });
  route('POST', '/api/manual-job/:id/upload', (p, b) => startManualUpload(Number(p.id), b ?? {}));
}

/** Đăng video ĐÃ DỰNG (job xong nhưng chưa upload) với metadata đã lưu (+ chỉnh trong body.meta nếu có). Chạy nền. */
export function startManualUpload(id, b = {}) {
  const j = get("SELECT * FROM job WHERE id=? AND kind='manual'", id);
  if (!j) throw new Error('Không có job thủ công #' + id);
  if (j.youtube_video_id) throw new Error('Job #' + id + ' đã đăng: https://youtu.be/' + j.youtube_video_id);
  if (j.status === 'uploading') throw new Error('Job #' + id + ' đang đăng');
  if (j.status !== 'done') throw new Error('Job #' + id + ' chưa dựng xong (' + j.status + ')');
  if (!j.video_path || !fs.existsSync(j.video_path)) throw new Error('Không còn file video của job #' + id);
  const m = JSON.parse(j.meta_json || '{}');
  const meta = { ...m.meta, ...(b.meta ?? {}) };
  if (!String(meta.title ?? '').trim()) throw new Error('Đăng YouTube cần tiêu đề');
  if (meta.privacy && !['private', 'unlisted', 'public'].includes(meta.privacy)) throw new Error('privacy: private|unlisted|public');
  if (meta.publishAt && isNaN(Date.parse(meta.publishAt))) throw new Error('publishAt không hợp lệ (ISO 8601)');
  const pl = get('SELECT * FROM playlist WHERE id=?', j.playlist_id);
  const ch = pl && get('SELECT * FROM channel WHERE id=?', pl.channel_id);
  if (!ch?.secrets_file || !fs.existsSync(ch.secrets_file)) throw new Error('Kênh thiếu file đăng nhập YouTube');
  m.meta = meta;
  run("UPDATE job SET status='uploading', meta_json=? WHERE id=?", JSON.stringify(m), id);
  const plan = j.plan_json ? JSON.parse(j.plan_json) : {};
  const logFile = logPath(`upload-manual${id}-${vnFileStamp()}.log`);
  const log = s => appendLog(logFile, s);
  (async () => {
    try {
      const descFile = path.join(manualOutDir(id), 'description.txt');
      fs.mkdirSync(path.dirname(descFile), { recursive: true });
      fs.writeFileSync(descFile, meta.description ?? '', 'utf8');
      const up = await uploadVideo({ secretsFile: ch.secrets_file, file: j.video_path, title: meta.title, descFile, tags: meta.tags ?? [],
        privacy: meta.privacy || 'private', thumb: plan.thumb && fs.existsSync(plan.thumb) ? plan.thumb : null, youtubePlaylist: meta.youtubePlaylist, publishAt: meta.publishAt, log });
      run("UPDATE job SET status='done', youtube_video_id=?, error=NULL WHERE id=?", up.videoId, id);
      log('Upload xong: https://youtu.be/' + up.videoId);
      if (plan.srt && fs.existsSync(plan.srt)) {
        try { scheduleCaption({ videoId: up.videoId, srtSrc: plan.srt, secretsFile: ch.secrets_file, delayHours: pl.caption_delay_hours ?? 6, lang: m.captionLang || 'vi', log }); }
        catch (e) { log('⚠ KHÔNG hẹn được phụ đề: ' + e.message); }
      }
    } catch (e) {
      run("UPDATE job SET status='done', error=? WHERE id=?", 'Đăng YouTube lỗi: ' + e.message, id);
      log('Lỗi: ' + e.message);
    }
  })();
  return { started: true, jobId: id, log: path.basename(logFile) };
}
