// M5 — Upload layer. REUSES the proven publisher scripts (pure-fetch, no npm):
//   upload-api.mjs          — resumable video upload (+thumb +playlist)
//   upload-caption-api.mjs  — .srt caption upload (scheduled +6h per anh Vũ's rule)
// We call them as child processes with the channel's secrets file from DB.
// NOTHING here re-implements OAuth or the YouTube API.
//
// DRY-RUN FIRST: buildUploadPlan() returns exactly what WOULD run. execUpload()
// refuses to run unless plan.approved === true (set by the UI approval step).
import { spawn } from 'node:child_process';
import { config, diskRoot } from '../config.mjs';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { get, run } from '../db/db.mjs';
import { thumbVf, CLASSIC_THUMB } from '../recipe/styles.mjs';

const PUB_SCRIPTS = config.uploadScriptsDir;
const UPLOAD_API = path.join(PUB_SCRIPTS, 'upload-api.mjs');
const CAPTION_API = path.join(PUB_SCRIPTS, 'upload-caption-api.mjs');

export function buildUploadPlan({ jobId, title, descFile, tags, thumbPath, srtPath }) {
  const job = get('SELECT * FROM job WHERE id=?', jobId);
  if (!job) throw new Error(`job ${jobId} không tồn tại`);
  // status hợp lệ theo schema: verifying (render+verify xong chờ duyệt) hoặc done
  if (job.status !== 'verifying' && job.status !== 'done')
    throw new Error(`job ${jobId} chưa render/verify xong (status=${job.status})`);
  const playlist = get('SELECT * FROM playlist WHERE id=?', job.playlist_id);
  const channel = get('SELECT * FROM channel WHERE id=?', playlist.channel_id);
  if (!channel.secrets_file || !existsSync(channel.secrets_file))
    throw new Error(`kênh ${channel.id} thiếu secrets file`);
  const videoPath = job.video_path;
  if (!videoPath || !existsSync(videoPath)) throw new Error(`file video không tồn tại: ${videoPath}`);

  // Quy tắc phụ đề 14/09: video PHẢI có phụ đề burn-in (verify đã kiểm) — .srt upload là lớp bổ sung.
  const plan = {
    job_id: jobId,
    channel_id: channel.id,
    secrets_file: channel.secrets_file,
    video: { path: videoPath, size_mb: Math.round(statSync(videoPath).size / 1048576) },
    title,
    desc_file: descFile ?? null,
    tags: tags ?? '',
    privacy: channel.default_privacy ?? 'private',   // luôn private chờ anh Vũ duyệt
    thumb: thumbPath && existsSync(thumbPath) ? thumbPath : null,
    youtube_playlist: playlist.youtube_playlist_id ?? null,
    srt: srtPath && existsSync(srtPath) ? srtPath : null,
    caption_delay_hours: 6,                          // SOP: hẹn phụ đề +6h sau upload
    approved: false,
  };
  plan.command_preview = [
    process.execPath, UPLOAD_API,
    '--file', plan.video.path, '--title', plan.title,
    ...(plan.desc_file ? ['--desc-file', plan.desc_file] : []),
    ...(plan.tags ? ['--tags', plan.tags] : []),
    '--privacy', plan.privacy,
    ...(plan.thumb ? ['--thumb', plan.thumb] : []),
    ...(plan.youtube_playlist ? ['--playlist', plan.youtube_playlist] : []),
  ];
  return plan;
}

export async function execUpload(plan, { log = console.log } = {}) {
  if (!plan.approved) throw new Error('KẾ HOẠCH CHƯA DUYỆT — execUpload từ chối chạy (dry-run only)');
  // config.mjs của publisher đọc env YTP_SECRETS_FILE (đã đọc source, không đoán)
  const out = await runNode(plan.command_preview.slice(1), {
    env: { ...process.env, YTP_SECRETS_FILE: plan.secrets_file },
    log,
  });
  const m = out.match(/"videoId"\s*:\s*"([^"]+)"/) || out.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  const videoId = m ? m[1] : null;
  if (!videoId) throw new Error('Upload không trả videoId — coi như thất bại. Output: ' + out.slice(-400));
  run(`UPDATE job SET status='done', youtube_video_id=?, finished_at=datetime('now') WHERE id=?`,
    videoId, plan.job_id);
  // Ghi usage tai diem canonical duy nhat: job len 'done' sau upload thanh cong.
  // recordUsage idempotent (kiem job_id truoc) nen test/verify goi truoc cung khong ghi doi.
  const { recordUsage } = await import('./usage.mjs');
  const u = recordUsage(plan.job_id);
  log?.('usage_log: ' + JSON.stringify(u));
  return { videoId, url: `https://youtu.be/${videoId}`, usage: u };
}

// Hẹn phụ đề +6h qua Windows Scheduled Task — theo chuẩn TOOLS.md đã học:
// /RU SYSTEM /RL HIGHEST + StartWhenAvailable (schtasks không đặt được cờ này → PowerShell bổ sung)
export function buildCaptionTaskCommands({ videoId, srtPath, secretsFile, delayHours = 6 }) {
  const when = new Date(Date.now() + delayHours * 3600e3);
  const hh = String(when.getHours()).padStart(2, '0');
  const mm = String(when.getMinutes()).padStart(2, '0');
  const sd = `${String(when.getMonth() + 1).padStart(2, '0')}/${String(when.getDate()).padStart(2, '0')}/${when.getFullYear()}`;
  const taskName = `YCF-caption-${videoId}`;
  const nodeExe = process.execPath;
  // caption script KHÔNG có --secrets; nhận creds qua env YTP_SECRETS_FILE (đọc từ config.mjs)
  const cmd = `cmd /c set YTP_SECRETS_FILE=${secretsFile}&& "${nodeExe}" "${CAPTION_API}" --video ${videoId} --srt "${srtPath}"`;
  return {
    taskName,
    create: `schtasks /Create /TN "${taskName}" /SC ONCE /ST ${hh}:${mm} /SD ${sd} /RU SYSTEM /RL HIGHEST /TR '${cmd}' /F`,
    patch: `$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; Set-ScheduledTask -TaskName '${taskName}' -Settings $s`,
  };
}

function runNode(args, { env, log }) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, { env, windowsHide: true });
    let buf = '';
    p.stdout.on('data', d => { buf += d; log('[upload] ' + String(d).trim()); });
    p.stderr.on('data', d => { buf += d; });
    p.on('close', code => code === 0 ? resolve(buf) : reject(new Error(`exit ${code}: ${buf.slice(-500)}`)));
  });
}

// =====================================================================================
// B3 (30/09): ĐĂNG THẬT cho chuỗi tự chạy — publishJob(jobId).
// Chữ SEO + chữ thumbnail bốc từ DB (kho chữ của playlist, chống lặp: dùng ít nhất trước),
// used_count CHỈ tăng sau khi upload thành công. Upload thử lại tối đa 3 lần (anh Vũ chốt 30/09).
// Hẹn phụ đề +N giờ bằng Windows Task quyền SYSTEM (anh Vũ chốt) — chép nguyên cách app cũ,
// gồm cả bẫy Set-ScheduledTask ghi đè Principal (27/09).
// =====================================================================================
import fs from 'node:fs';
import { spawnSync, execSync } from 'node:child_process';
import { all } from '../db/db.mjs';

import { fileURLToPath } from 'node:url';
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CAPTION_DIR = path.join(APP_ROOT, 'captions');   // NGOÀI thư mục dọn — giữ .srt tới khi phụ đề lên
const EPISODE_FILE = config.episodeFile; // dùng chung số tập với app cũ

function pickLeastUsed(rows) {
  if (!rows.length) return null;
  const min = Math.min(...rows.map(r => r.used_count));
  const cand = rows.filter(r => r.used_count === min);
  return cand[Math.floor(Math.random() * cand.length)];
}
const hms = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; };

export function chaptersFromPlan(plan) {
  const NAME = { hook: 'Lời mở đầu', outro: 'Lời kết', 'tail:background': 'Nhạc thiền an giấc', 'tail:black': 'Màn hình tối – nhạc ru ngủ' };
  const out = [];
  for (const t of plan.timeline ?? []) {
    const title = t.kind === 'story' ? (t.source?.title || 'Câu chuyện') : NAME[t.kind];
    if (title) out.push({ start: t.start_s, title });
  }
  if (out.length) out[0].start = 0; // YouTube đòi chương đầu ở 00:00:00
  return out;
}

// Bốc SEO + chữ thumbnail (chưa đánh dấu đã dùng). Thiếu kho chữ → lỗi rõ ràng.
// 06/10 (báo cáo US03): YouTube bọc tag có dấu cách trong "..." và 2 ngoặc kép TÍNH vào giới hạn 500.
// Cũ đếm len+1, trần 480 → thực tế ~515-540 → HTTP 400 "invalid video keywords".
export function tagCost(x, first) { return (/\s/.test(x) ? x.length + 2 : x.length) + (first ? 0 : 1); }
export function fitTags(cands, limit = 490) {
  const out = []; let len = 0;
  for (const raw of cands) {
    const x = String(raw ?? '').trim();
    if (!x || out.includes(x) || /[<>]/.test(x)) continue;
    const c = tagCost(x, out.length === 0);
    if (len + c > limit) continue;      // bỏ tag này, thử tag ngắn hơn phía sau
    out.push(x); len += c;
  }
  return out;
}
export const tagsLength = tags => tags.reduce((s, x, i) => s + tagCost(x, i === 0), 0);
const stripAngle = s => String(s ?? '').replace(/[<>]/g, ''); // YouTube cấm < > ở tiêu đề/mô tả

// 08/10: kiểu chữ thumbnail playlist đã chọn (chưa chọn / kiểu bị xoá → Cổ điển như cũ)
function thumbStyleOf(playlist) {
  const st = playlist?.thumb_style_id ? get("SELECT params FROM style WHERE id=? AND kind='thumb'", playlist.thumb_style_id) : null;
  return st ? JSON.parse(st.params) : CLASSIC_THUMB;
}
export function pickTexts(playlist, plan) {
  if (!playlist.text_pool_id) throw new Error(`playlist ${playlist.id} chưa chọn kho chữ/SEO`);
  const pool = playlist.text_pool_id;
  const seo = kind => all("SELECT * FROM seo_item WHERE pool_id=? AND kind=? AND status='active'", pool, kind);
  const t = pickLeastUsed(seo('title')); if (!t) throw new Error(`kho chữ ${pool} không còn tiêu đề`);
  const d = pickLeastUsed(seo('description')); if (!d) throw new Error(`kho chữ ${pool} không có mô tả`);
  const tagRows = seo('tags');
  const tags = fitTags(tagRows.flatMap(r => r.content.split(',').map(s => s.trim()).filter(Boolean)));
  const th = pickLeastUsed(all("SELECT * FROM thumbnail_text WHERE pool_id=? AND status='active'", pool));
  if (!th) throw new Error(`kho chữ ${pool} không còn chữ thumbnail`);
  let title = t.content, episode = null;
  if (playlist.episode_numbering) {
    try { episode = fs.existsSync(EPISODE_FILE) ? JSON.parse(fs.readFileSync(EPISODE_FILE, 'utf8')).next : 1; } catch { episode = null; } // máy mới: bắt đầu từ số 1
    if (!Number.isInteger(episode)) throw new Error('không đọc được số tập ' + EPISODE_FILE);
    const ch = get('SELECT name FROM channel WHERE id=?', playlist.channel_id)?.name ?? '';
    title = `${ch}: Số ${String(episode).padStart(2, '0')} | ${title}`;
  }
  const chapters = chaptersFromPlan(plan);
  const timeline = chapters.length ? '🕉️ CHƯƠNG MỤC / TIMELINE:\n' + chapters.map(c => `${hms(c.start)} ${c.title}`).join('\n') : '';
  const body = d.content.includes('{TIMELINE}') ? d.content.replace('{TIMELINE}', timeline).trim() : (d.content.trim() + (timeline ? '\n\n' + timeline : ''));
  // 02/10: Phần kết & hashtag (ket-hashtag.txt, chung cho mọi video) LUÔN ở cuối; vượt giới hạn thì cắt phần mô tả, không cắt phần kết.
  const ending = (pickLeastUsed(seo('ending'))?.content ?? '').trim();
  const description = ending ? body.slice(0, 4900 - ending.length - 2).trimEnd() + '\n\n' + ending : body;
  // Dòng phụ thumbnail: kho chữ không có thì dùng tên kênh (+ số giờ với video dài) — như dòng "sub" của app cũ
  const chName = get('SELECT name FROM channel WHERE id=?', playlist.channel_id)?.name ?? '';
  const hours = Math.round((plan.total_s ?? 0) / 3600);
  const sub = th.sub_line || (hours >= 2 ? `${chName} • Giấc Ngủ An Yên ${hours} Giờ` : chName);
  return { title: stripAngle(title).slice(0, 100), description: stripAngle(description).slice(0, 4900), tags, thumb: { ...th, sub_line: sub, style: thumbStyleOf(playlist) }, ids: { title: t.id, description: d.id, thumbnail_text: th.id }, episode };
}
export function markTextsUsed(picks) {
  run("UPDATE seo_item SET used_count=used_count+1, last_used_at=datetime('now') WHERE id IN (?,?)", picks.ids.title, picks.ids.description);
  run("UPDATE thumbnail_text SET used_count=used_count+1, last_used_at=datetime('now') WHERE id=?", picks.ids.thumbnail_text);
  if (picks.episode != null) fs.writeFileSync(EPISODE_FILE, JSON.stringify({ next: picks.episode + 1, updated: new Date().toISOString() }, null, 1), 'utf8');
}

// Thumbnail: khung hình lấy từ SHOT GỐC (không dính phụ đề burn-in), bộ lọc chép từ make-thumb-zoom.mjs của app cũ.
export function makeThumbnail({ plan, offsetS, texts, outPath, ffmpeg }) {
  const c = plan.compose;
  let t = Math.max(0, offsetS ?? 150), i = 0;
  const n = c.shots_base.length;
  for (let k = 0; k < 100000 && t >= (c.shots_base_durations?.[k % n] ?? Infinity); k++) { t -= c.shots_base_durations[k % n]; i = (k + 1) % n; }
  const src = c.shots_base[i];
  const vf = thumbVf(texts.style ?? CLASSIC_THUMB, texts); // 08/10: theo kiểu playlist chọn
  const r = spawnSync(ffmpeg, ['-y', '-v', 'error', '-ss', String(Math.max(0, t - 0.1)), '-i', src, '-frames:v', '1', '-update', '1', '-vf', vf, '-q:v', '2', outPath], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(outPath)) throw new Error('Tạo thumbnail lỗi: ' + (r.stderr || '').slice(-300));
  return { path: outPath, source: src, at_s: t };
}

// Upload thật: thử lại tối đa `retries` lần khi KHÔNG nhận được videoId (không upload trùng khi đã có id).
export async function uploadVideo({ secretsFile, file, title, descFile, tags, privacy, thumb, youtubePlaylist, retries = 3, log = () => {} }) {
  const args = [UPLOAD_API, '--file', file, '--title', title, '--desc-file', descFile, '--privacy', privacy || 'private',
    ...(tags?.length ? ['--tags', tags.join(',')] : []), ...(thumb ? ['--thumb', thumb] : []), ...(youtubePlaylist ? ['--playlist', youtubePlaylist] : [])];
  let lastErr;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    log(`Upload lần ${attempt}/${retries + 1}…`);
    try {
      const out = await runNode(args, { env: { ...process.env, YTP_SECRETS_FILE: secretsFile }, log });
      const m = out.match(/"videoId"\s*:\s*"([^"]+)"/) || out.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
      if (!m) throw new Error('không trả videoId: ' + out.slice(-300));
      const last = out.trim().split('\n').reverse().find(l => l.trim().startsWith('{')) ?? '{}';
      let res = {}; try { res = JSON.parse(last); } catch {}
      return { videoId: m[1], attempt, thumbnail: res.thumbnail ?? null, playlist: res.playlist ?? null };
    } catch (e) { lastErr = e; log(`Upload lần ${attempt} lỗi: ${String(e.message).slice(0, 300)}`); if (attempt <= retries) await new Promise(r => setTimeout(r, 30000 * attempt)); }
  }
  throw new Error(`Upload thất bại sau ${retries + 1} lần: ${String(lastErr?.message).slice(0, 300)}`);
}

// Hẹn phụ đề: .srt giữ ở captions/<videoId>/, task SYSTEM chạy bù khi máy tắt đúng giờ.
export function scheduleCaption({ videoId, srtSrc, secretsFile, delayHours = 6, log = () => {} }) {
  const dir = path.join(CAPTION_DIR, videoId);
  fs.mkdirSync(dir, { recursive: true });
  const capSrt = path.join(dir, `${videoId}.srt`);
  fs.copyFileSync(srtSrc, capSrt);
  const runAt = new Date(Date.now() + delayHours * 3600e3);
  const taskName = `YCF-caption-${videoId}`;
  const runner = path.join(dir, 'run-caption.cmd'), capLog = path.join(dir, 'caption.log');
  fs.writeFileSync(runner,
    `@echo off\r\n` +
    `set "YTP_SECRETS_FILE=${secretsFile}"\r\n` +
    `echo [%date% %time%] === Bat dau upload phu de cho video ${videoId} === >> "${capLog}"\r\n` +
    `"${process.execPath}" "${CAPTION_API}" --video ${videoId} --srt "${capSrt}" --lang vi >> "${capLog}" 2>&1\r\n` +
    `if %ERRORLEVEL%==0 ( echo [%date% %time%] KET QUA: THANH CONG >> "${capLog}" ) else ( echo [%date% %time%] KET QUA: THAT BAI exitcode=%ERRORLEVEL% - giu file .srt de xu ly tay >> "${capLog}" )\r\n` +
    `schtasks /Delete /TN "${taskName}" /F >nul 2>&1\r\n`);
  const pad = x => String(x).padStart(2, '0');
  execSync(`schtasks /Create /TN "${taskName}" /SC ONCE /ST ${pad(runAt.getHours())}:${pad(runAt.getMinutes())} ` +
    `/SD ${pad(runAt.getMonth() + 1)}/${pad(runAt.getDate())}/${runAt.getFullYear()} /RU SYSTEM /RL HIGHEST /TR "\\"${runner}\\"" /F`, { encoding: 'utf8' });
  // BẪY 27/09: Set-ScheduledTask -Settings mà không truyền -Principal sẽ ghi đè về Interactive → phải truyền cả hai, rồi KIỂM lại.
  const ps = `$s=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1); ` +
    `$p=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest; ` +
    `Set-ScheduledTask -TaskName '${taskName}' -Settings $s -Principal $p | Out-Null; ` +
    `$c=Get-ScheduledTask -TaskName '${taskName}'; ` +
    `if($c.Principal.LogonType -ne 'ServiceAccount' -or -not $c.Settings.StartWhenAvailable){ throw 'task sai: ' + $c.Principal.LogonType }`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error('Không đặt được chế độ chạy bù cho task phụ đề: ' + (r.stderr || r.stdout).slice(-300));
  const vn = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(runAt);
  log(`Đã hẹn đăng phụ đề lúc ${vn} giờ VN (task ${taskName}), .srt giữ tại ${capSrt}`);
  return { taskName, runAt: runAt.toISOString(), srt: capSrt };
}
