// slideshow.mjs - nền video từ ảnh (video thủ công, 11/2026).
// Mỗi ảnh: phóng + cắt lấp đầy W×H, zoom nhẹ (zoompan), 30 fps. Chuyển cảnh xfade ngẫu nhiên 1s (danh sách đã kiểm).
// DỰNG THEO KHÚC: ≤15 ảnh/khúc → mp4 trung gian → concat demuxer (copy) → cắt đúng thời lượng.
// KHÔNG bao giờ một filtergraph khổng lồ. Giữa các khúc là cắt thẳng (không xfade).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ffmpegPath } from '../recipe/manual-plan.mjs';

export const XFADES = ['fade', 'slideleft', 'slideright', 'wipeleft', 'circleopen', 'dissolve', 'smoothleft'];
export const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const FPS = 30, XD = 1, CHUNK = 15;

export function listImages(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (IMAGE_EXTS.includes(path.extname(e.name).toLowerCase())) out.push(p);
    }
  })(dir);
  return out.sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
}

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function shuffle(a, r) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/** Dựng 1 khúc: k ảnh → mp4 dài k*S - (k-1)*XD (k=1 → S). */
function renderChunk(imgs, S, W, H, out, r) {
  const frames = Math.round(S * FPS);
  const ins = [], parts = [];
  const CW = Math.round(W * 1.5 / 2) * 2, CH = Math.round(H * 1.5 / 2) * 2; // dựng lớn hơn → zoom mượt, đỡ rung
  imgs.forEach((f, i) => {
    ins.push('-i', f);
    const zin = r() < 0.5;
    const z = zin ? `1+0.10*on/${frames}` : `1.10-0.10*on/${frames}`;
    parts.push(`[${i}:v]scale=${CW}:${CH}:force_original_aspect_ratio=increase,crop=${CW}:${CH},setsar=1,format=yuv420p,` +
      `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},trim=end_frame=${frames},setpts=PTS-STARTPTS,settb=AVTB[v${i}]`);
  });
  let last = 'v0';
  for (let i = 1; i < imgs.length; i++) {
    const t = XFADES[Math.floor(r() * XFADES.length)];
    const off = (i * (S - XD)).toFixed(3);
    parts.push(`[${last}][v${i}]xfade=transition=${t}:duration=${XD}:offset=${off}[x${i}]`);
    last = 'x' + i;
  }
  parts.push(`[${last}]format=yuv420p[out]`);
  const a = ['-y', '-v', 'error', ...ins, '-filter_complex', parts.join(';'), '-map', '[out]', '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', String(FPS), out];
  const res = spawnSync(ffmpegPath(), a, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (res.status !== 0) throw new Error('Dựng khúc ảnh lỗi: ' + (res.stderr || '').slice(-600));
  return imgs.length * S - (imgs.length - 1) * XD;
}

/**
 * images: mảng đường dẫn ảnh. order: 'shuffle'|'sorted'. Trả { path, chunks, images_used, duration_s }.
 * Ảnh được lặp (vòng lại danh sách) cho tới khi phủ hết `duration`.
 */
export function renderSlideshow({ images, secPerImage = 8, width, height, duration, order = 'shuffle', workDir, outPath, seed = Date.now(), log = () => {} }) {
  const S = Number(secPerImage);
  if (!(S >= 2 && S <= 120)) throw new Error('Số giây mỗi ảnh: 2-120');
  if (!images?.length) throw new Error('Không có ảnh nào');
  if (!(duration > 0)) throw new Error('Thiếu thời lượng');
  const r = rng(seed);
  const base = order === 'sorted' ? images.slice() : shuffle(images, r);
  const dir = path.join(workDir, 'slideshow'); fs.mkdirSync(dir, { recursive: true });
  // số ảnh cần: mỗi khúc k ảnh dài k*S-(k-1)*XD → tính dần
  const seq = []; let covered = 0, inChunk = 0;
  while (covered < duration + 0.5) {
    seq.push(base[seq.length % base.length]);
    covered += inChunk === 0 ? S : S - XD;
    inChunk = (inChunk + 1) % CHUNK;
  }
  const chunks = [];
  for (let i = 0; i < seq.length; i += CHUNK) chunks.push(seq.slice(i, i + CHUNK));
  const files = [];
  chunks.forEach((c, i) => {
    const f = path.join(dir, `chunk-${String(i).padStart(4, '0')}.mp4`);
    const t0 = Date.now();
    renderChunk(c, S, width, height, f, r);
    files.push(f);
    log(`slideshow khúc ${i + 1}/${chunks.length}: ${c.length} ảnh (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  });
  const list = path.join(dir, 'list.txt');
  fs.writeFileSync(list, files.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const res = spawnSync(ffmpegPath(), ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-t', duration.toFixed(3), outPath], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error('Nối khúc ảnh lỗi: ' + (res.stderr || '').slice(-600));
  fs.rmSync(dir, { recursive: true, force: true }); // dọn trung gian
  return { path: outPath, chunks: chunks.length, images_used: seq.length, duration_s: duration };
}
