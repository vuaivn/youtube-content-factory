// slideshow.mjs - nền video từ ảnh (video thủ công, 11/2026).
// Mỗi ảnh: phóng + cắt lấp đầy W×H, zoom nhẹ (zoompan), 30 fps. Chuyển cảnh xfade ngẫu nhiên 1s (danh sách đã kiểm).
// DỰNG THEO KHÚC: ≤15 ảnh/khúc → mp4 trung gian → concat demuxer (copy) → cắt đúng thời lượng.
// KHÔNG bao giờ một filtergraph khổng lồ. Ranh giới khúc nằm giữa 1 ảnh → nối liền.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ffmpegPath } from '../recipe/manual-plan.mjs';

export const XFADES = ['fade', 'fade', 'dissolve']; // chỉ chuyển cảnh mềm (bỏ slide/wipe/circle - chủ kênh chê giật)
export const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const FPS = 30, CHUNK = 15, ZOOM = 0.06, UPSCALE = 3; // phóng nền 3x trước zoompan → hết rung do làm tròn

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

/** Dựng 1 khúc: items [{f, zin, from, to}] (khung trong clip ảnh F khung) → mp4. Ảnh nối bằng xfade XDf khung. */
function renderChunk(items, F, XDf, W, H, out, trans) {
  const ins = [], parts = [];
  const BW = W * UPSCALE, BH = H * UPSCALE;
  items.forEach((it, i) => {
    ins.push('-i', it.f);
    const z = it.zin ? `1+${ZOOM}*on/${F}` : `${1 + ZOOM}-${ZOOM}*on/${F}`;
    parts.push(`[${i}:v]scale=${BW}:${BH}:force_original_aspect_ratio=increase,crop=${BW}:${BH},setsar=1,` +
      `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${F}:s=${W}x${H}:fps=${FPS},` +
      `trim=start_frame=${it.from}:end_frame=${it.to},setpts=PTS-STARTPTS,format=yuv420p,settb=AVTB[v${i}]`);
  });
  let last = 'v0', acc = items[0].to - items[0].from;
  for (let i = 1; i < items.length; i++) {
    const off = ((acc - XDf) / FPS).toFixed(4);
    parts.push(`[${last}][v${i}]xfade=transition=${trans[i - 1]}:duration=${(XDf / FPS).toFixed(4)}:offset=${off}[x${i}]`);
    acc += items[i].to - items[i].from - XDf; last = 'x' + i;
  }
  parts.push(`[${last}]format=yuv420p[out]`);
  const a = ['-y', '-v', 'error', ...ins, '-filter_complex', parts.join(';'), '-map', '[out]', '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', String(FPS), out];
  const res = spawnSync(ffmpegPath(), a, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (res.status !== 0) throw new Error('Dựng khúc ảnh lỗi: ' + (res.stderr || '').slice(-600));
  return acc;
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
  // Dòng thời gian liên tục: ảnh j bắt đầu ở j*(S-XD). Ranh giới khúc cắt giữa 1 ảnh (ngoài vùng xfade):
  // khúc trước dừng ở khung giữa ảnh X, khúc sau dựng lại X (zoom tất định) từ khung đó → nối liền, không cắt thẳng.
  const XD = Math.min(1.2, S / 3), F = Math.round(S * FPS), XDf = Math.round(XD * FPS), MID = Math.floor(F / 2);
  const seq = []; let covered = 0;
  while (covered < duration + 0.5) { seq.push({ f: base[seq.length % base.length], zin: r() < 0.5 }); covered += seq.length === 1 ? S : S - XD; }
  const trans = seq.map(() => XFADES[Math.floor(r() * XFADES.length)]);
  const chunks = [];
  for (let s0 = 0; s0 < seq.length; s0 += CHUNK) {
    const e = Math.min(seq.length - 1, s0 + CHUNK); // gồm ảnh chồng ở cuối (nếu còn)
    const items = [];
    for (let j = s0; j <= e; j++) items.push({ ...seq[j], from: j === s0 && s0 > 0 ? MID : 0, to: j === e && e < seq.length - 1 ? MID : F });
    chunks.push({ items, trans: trans.slice(s0, e) });
    if (e === seq.length - 1) break;
  }
  const files = [];
  chunks.forEach((c, i) => {
    const f = path.join(dir, `chunk-${String(i).padStart(4, '0')}.mp4`);
    const t0 = Date.now();
    renderChunk(c.items, F, XDf, width, height, f, c.trans);
    files.push(f);
    log(`slideshow khúc ${i + 1}/${chunks.length}: ${c.items.length} ảnh (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  });  const list = path.join(dir, 'list.txt');
  fs.writeFileSync(list, files.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const res = spawnSync(ffmpegPath(), ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-t', duration.toFixed(3), outPath], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error('Nối khúc ảnh lỗi: ' + (res.stderr || '').slice(-600));
  fs.rmSync(dir, { recursive: true, force: true }); // dọn trung gian
  return { path: outPath, chunks: chunks.length, images_used: seq.length, duration_s: duration };
}

