// manual-render.mjs - dựng video thủ công: giọng (thứ tự anh chọn) + nền ảnh (slideshow) hoặc video nền có sẵn
// + phụ đề .ass burn-in đúng độ phân giải. Dùng compose2.mjs cho bước mux cuối (cùng đường ống với recipe).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildManualPlan, writeManualSrt, buildVoiceTrack, ffmpegPath, ffprobePath, probeDuration } from '../recipe/manual-plan.mjs';
import { aspectSize, srtToAss, buildAss, validateManualSub, scaleSub } from '../recipe/manual-style.mjs';
import { renderSlideshow, listImages } from './slideshow.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPOSE = path.join(HERE, 'compose2.mjs');
const ffEsc = p => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

/**
 * opts: { voiceIds | voiceFiles, gap, imageDir | images | backgroundVideo, secPerImage, order, aspect, subStyle, workDir, outDir, seed, log }
 * Trả { video, srt, ass, thumb, duration_s, plan, timing }
 */
export function renderManual(o) {
  const log = o.log ?? (() => {});
  const { width: W, height: H, scale } = aspectSize(o.aspect ?? 'horizontal', o.quality ?? '1080');
  const style = scaleSub(validateManualSub(o.subStyle), scale);
  fs.mkdirSync(o.workDir, { recursive: true }); fs.mkdirSync(o.outDir, { recursive: true });
  const timing = {}; let t0 = Date.now();
  const plan = buildManualPlan({ voiceIds: o.voiceIds, files: o.voiceFiles, gap: o.gap ?? 0.5 });
  const T = plan.total_s;
  log(`Kế hoạch: ${plan.timeline.length} file giọng, tổng ${T.toFixed(2)}s (khoảng lặng ${plan.gap_s}s), ${W}x${H}`);
  const srt = path.join(o.outDir, 'video.srt');
  const ms = writeManualSrt(plan, srt);
  const ass = srtToAss(srt, path.join(o.workDir, 'sub.ass'), style, W, H);
  const voice = buildVoiceTrack(plan, path.join(o.workDir, 'voice.wav'));
  timing.audio_s = (Date.now() - t0) / 1000; t0 = Date.now();
  log(`Phụ đề gộp: ${ms.cue_count} câu · giọng ghép: ${probeDuration(voice).toFixed(2)}s`);

  let shots;
  if (o.backgroundVideo) {
    if (!fs.existsSync(o.backgroundVideo)) throw new Error('Không có video nền: ' + o.backgroundVideo);
    const bd = probeDuration(o.backgroundVideo);
    shots = Array(Math.ceil(T / bd) + 1).fill(o.backgroundVideo);
    log(`Nền: video có sẵn ${path.basename(o.backgroundVideo)} (${bd.toFixed(1)}s × ${shots.length})`);
  } else {
    const images = o.images ?? listImages(o.imageDir);
    if (!images.length) throw new Error('Thư mục ảnh trống: ' + o.imageDir);
    const bg = path.join(o.workDir, 'bg.mp4');
    const ss = renderSlideshow({ images, secPerImage: o.secPerImage ?? 8, width: W, height: H, duration: T + 0.5, order: o.order ?? 'shuffle', workDir: o.workDir, outPath: bg, seed: o.seed, log });
    log(`Nền ảnh: ${images.length} ảnh gốc, ${ss.images_used} lượt, ${ss.chunks} khúc`);
    shots = [bg];
  }
  timing.background_s = (Date.now() - t0) / 1000; t0 = Date.now();

  // thumbnail: khung từ NỀN (chưa có phụ đề), cạnh dài ≤1280 (YouTube ≤2 MB)
  const thumb = path.join(o.outDir, 'thumb.jpg');
  const tw = W >= H ? Math.min(1280, W) : Math.round(Math.min(1280, H) * W / H / 2) * 2;
  const th = Math.round(tw * H / W / 2) * 2;
  const tr = spawnSync(ffmpegPath(), ['-y', '-v', 'error', '-ss', String(Math.min(5, T / 2)), '-i', shots[0], '-frames:v', '1', '-update', '1',
    '-vf', `scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th}`, '-q:v', '3', thumb], { encoding: 'utf8' });
  if (tr.status !== 0) log('⚠ thumbnail lỗi: ' + (tr.stderr || '').slice(-200));

  const video = path.join(o.outDir, 'video.mp4');
  const spec = { output: video, workdir: path.join(o.workDir, '_compose'), width: W, height: H, fps: 30, shots, voiceover: [voice], subtitle: ass, max_duration_sec: T };
  const specPath = path.join(o.workDir, 'spec.json');
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 1));
  const r = spawnSync(process.execPath, [COMPOSE, specPath, '--force'], { encoding: 'utf8', maxBuffer: 1 << 28,
    env: { ...process.env, FFMPEG: ffmpegPath(), FFPROBE: ffprobePath() } });
  if (r.status !== 0 || !fs.existsSync(video)) throw new Error('compose2 lỗi: ' + ((r.stdout || '') + (r.stderr || '')).slice(-800));
  timing.compose_s = (Date.now() - t0) / 1000;
  const d = probeDuration(video);
  log(`Xong: ${video} (${d.toFixed(2)}s)`);
  return { video, srt, ass, thumb: fs.existsSync(thumb) ? thumb : null, duration_s: d, plan, timing, width: W, height: H };
}

/** 1 khung PNG xem thử phụ đề trên ảnh thật. Trả Buffer PNG. */
export function previewFrame({ style, aspect, quality, imageDir, image, sampleText, workDir }) {
  const { width: W, height: H, scale } = aspectSize(aspect ?? 'horizontal', quality ?? '1080');
  style = scaleSub(validateManualSub(style), scale);
  const img = image ?? (imageDir ? listImages(imageDir)[0] : null);
  const dir = path.join(workDir, 'preview'); fs.mkdirSync(dir, { recursive: true });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const ass = path.join(dir, `pv-${id}.ass`), out = path.join(dir, `pv-${id}.png`);
  const text = String(sampleText || 'Phụ đề xem thử\n南無阿彌陀佛').split(/\r?\n/);
  fs.writeFileSync(ass, buildAss([{ start: 0, end: 10, lines: text }], style, W, H), 'utf8');
  const input = img ? ['-i', img] : ['-f', 'lavfi', '-i', `color=c=gray:s=${W}x${H}`];
  const r = spawnSync(ffmpegPath(), ['-y', '-v', 'error', ...input, '-frames:v', '1',
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,ass='${ffEsc(ass)}'`, out], { encoding: 'utf8' });
  try { fs.unlinkSync(ass); } catch {}
  if (r.status !== 0 || !fs.existsSync(out)) throw new Error('Xem thử lỗi: ' + (r.stderr || '').slice(-400));
  const buf = fs.readFileSync(out); fs.unlinkSync(out);
  return buf;
}
