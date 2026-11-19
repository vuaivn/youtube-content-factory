// manual-plan.mjs - video thủ công: danh sách giọng (theo thứ tự) → timeline + .srt gộp.
// Thời lượng lấy từ ffprobe (KHÔNG từ giờ kết thúc .srt). Giữa 2 file có khoảng lặng `gap` giây (mặc định 0.5).
// File i bắt đầu ở offset = Σ(dur[j] + gap), j < i. .srt mỗi file dịch theo offset đó (buildMergedSrt).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { get, all } from '../db/db.mjs';
import { config } from '../config.mjs';
import { buildMergedSrt, srtForVoiceSegment } from '../execute/subtitle.mjs';

export const ffmpegPath = () => config.ffmpeg || get("SELECT path FROM tool WHERE name='ffmpeg'")?.path || 'ffmpeg';
export const ffprobePath = () => ffmpegPath().replace(/ffmpeg(\.exe)?$/i, m => m.replace(/ffmpeg/i, 'ffprobe'));

export function probeDuration(fp) {
  const r = spawnSync(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', fp], { encoding: 'utf8', timeout: 60_000 });
  const d = parseFloat(r.stdout);
  if (!(d > 0)) throw new Error('Không đọc được thời lượng: ' + fp);
  return d;
}

/** voiceIds: id asset (kho kind='voice'), theo thứ tự. files: dùng thẳng đường dẫn (test). */
export function buildManualPlan({ voiceIds = null, files = null, gap = 0.5 }) {
  gap = Math.max(0, Math.min(10, Number(gap ?? 0.5)));
  let list;
  if (files) list = files.map(f => ({ id: null, file_path: f, title: null }));
  else {
    if (!Array.isArray(voiceIds) || !voiceIds.length) throw new Error('Chưa chọn file giọng nào');
    list = voiceIds.map(id => {
      const a = get(`SELECT a.id, a.file_path, a.title, a.status, ap.kind FROM asset a JOIN asset_pool ap ON ap.id=a.pool_id WHERE a.id=?`, Number(id));
      if (!a) throw new Error('Không có file giọng #' + id);
      if (a.status !== 'active') throw new Error(`File giọng #${id} đang ${a.status}`);
      return a;
    });
  }
  const timeline = []; let t = 0;
  list.forEach((a, i) => {
    if (!fs.existsSync(a.file_path)) throw new Error('File giọng không còn trên ổ: ' + a.file_path);
    if (!srtForVoiceSegment(a.file_path)) throw new Error('Thiếu .srt cùng tên: ' + a.file_path);
    const dur = probeDuration(a.file_path);
    timeline.push({ kind: 'story', start_s: t, end_s: t + dur, dur_s: dur, source: { id: a.id, file_path: a.file_path, title: a.title } });
    t += dur + (i < list.length - 1 ? gap : 0);
  });
  return { kind: 'manual', gap_s: gap, total_s: t, timeline };
}

export function writeManualSrt(plan, outPath) {
  const r = buildMergedSrt(plan, outPath);
  if (!r.ok) throw new Error('Gộp phụ đề lỗi: ' + r.error);
  return r;
}

/** Ghép giọng + khoảng lặng thành 1 wav 48k stereo, mỗi đoạn cắt/đệm ĐÚNG (dur+gap) → khớp offset .srt. */
export function buildVoiceTrack(plan, outPath) {
  const ins = [], parts = [];
  plan.timeline.forEach((s, i) => {
    ins.push('-i', s.source.file_path);
    const X = (i < plan.timeline.length - 1 ? s.dur_s + plan.gap_s : s.dur_s).toFixed(4);
    parts.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=${X},atrim=0:${X},asetpts=N/SR/TB[a${i}]`);
  });
  const fc = parts.join(';') + ';' + plan.timeline.map((_, i) => `[a${i}]`).join('') + `concat=n=${plan.timeline.length}:v=0:a=1[out]`;
  const r = spawnSync(ffmpegPath(), ['-y', '-v', 'error', ...ins, '-filter_complex', fc, '-map', '[out]', '-c:a', 'pcm_s16le', outPath], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error('Ghép giọng lỗi: ' + (r.stderr || '').slice(-500));
  return outPath;
}

const IMG_EXT = /\.(jpe?g|png|webp)$/i;
/** Thư mục ảnh tuyệt đối từ kho + đường dẫn tương đối (chặn ../). */
export function imageDirOf(poolId, rel) {
  const pool = get("SELECT * FROM asset_pool WHERE id=? AND kind='image'", poolId);
  if (!pool) throw new Error('Không có kho ảnh ' + poolId);
  const dir = path.resolve(pool.root_dir, rel || '');
  if (path.relative(pool.root_dir, dir).startsWith('..')) throw new Error('Thư mục ngoài kho');
  if (!fs.existsSync(dir)) throw new Error('Không có thư mục ' + dir);
  return dir;
}
// Ảnh lấy theo DB (chỉ file active) trong thư mục chọn, đệ quy
export function imagesOf(poolId, rel) {
  const dir = imageDirOf(poolId, rel);
  return all("SELECT file_path FROM asset WHERE pool_id=? AND status='active'", poolId).map(r => r.file_path)
    .filter(f => IMG_EXT.test(f) && !path.relative(dir, f).startsWith('..') && fs.existsSync(f));
}

export function manualOutDir(jobId) { return path.join(config.workDir, 'manual-out', 'job' + jobId); }

