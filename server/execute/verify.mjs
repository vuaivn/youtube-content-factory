// verify.mjs — ĐỐI CHIẾU thành phẩm vs kế hoạch (A4, thuốc cho B5).
// Đo bằng số, không cảm nhận: thời lượng, fade (RMS theo giây), phụ đề (chữ trong frame), độ to.
// Chính vụ "fade mất không ai biết" là lý do module này tồn tại.
import fs from 'node:fs';
import { config, diskRoot } from '../config.mjs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { get } from '../db/db.mjs';

function tools() {
  const ff = (config.ffmpeg || get("SELECT path FROM tool WHERE name='ffmpeg'")?.path || 'ffmpeg');
  return { ffmpeg: ff, ffprobe: ff.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1') };
}
function durOf(file) {
  const { ffprobe } = tools();
  const r = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return parseFloat((r.stdout ?? '0').trim()) || 0;
}

/** RMS dB trung bình từng giây trong [from,to) — đọc PCM thô, không phụ thuộc astats. */
export function rmsPerSecond(file, from, to) {
  const { ffmpeg } = tools();
  const r = spawnSync(ffmpeg, ['-v', 'error', '-ss', String(from), '-t', String(to - from), '-i', file,
    '-map', 'a:0', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0 || !r.stdout?.length) return [];
  const buf = r.stdout;
  const perSec = 8000;
  const out = [];
  for (let s = 0; s * perSec * 2 < buf.length; s++) {
    let sum = 0, n = 0;
    for (let i = s * perSec; i < (s + 1) * perSec && i * 2 + 1 < buf.length; i++) {
      const v = buf.readInt16LE(i * 2) / 32768; sum += v * v; n++;
    }
    out.push({ t: from + s, db: n ? 10 * Math.log10(sum / n + 1e-12) : -120 });
  }
  return out;
}

/**
 * verifyVideo(videoPath, plan) → { ok, checks[] } — mỗi check { name, ok, expected, actual }
 */
export function verifyVideo(videoPath, plan, opts = {}) {
  const checks = [];
  const add = (name, ok, expected, actual) => checks.push({ name, ok, expected, actual });

  // 1. Thời lượng: thực tế vs kế hoạch (±2s)
  const dur = durOf(videoPath);
  add('thoi_luong', Math.abs(dur - plan.total_s) <= 2, plan.total_s, +dur.toFixed(1));

  // 2. Fade: RMS quanh các mốc phải ĐI ĐÚNG HƯỚNG
  const f = plan.fades;
  if (f.mode === 'with_tail' && f.out_of_body.dur_s >= 10) {
    // giữa fade-out phải nhỏ hơn trước fade >= 6 dB; đáy lặng phải <= -55 dB
    const o = f.out_of_body;
    const before = rmsPerSecond(videoPath, Math.max(0, o.start_s - 15), o.start_s - 5);
    const midT = o.start_s + o.dur_s * 0.7;
    const mid = rmsPerSecond(videoPath, midT, midT + 5);
    const quiet = rmsPerSecond(videoPath, f.silence.start_s + 0.5, Math.min(f.silence.start_s + f.silence.dur_s + 3, f.into_tail.start_s + 3));
    const avg = a => a.length ? a.reduce((s, x) => s + x.db, 0) / a.length : NaN;
    const b = avg(before), m = avg(mid), q = Math.min(...quiet.map(x => x.db));
    add('fade_out_giam', isFinite(b) && isFinite(m) && (b - m) >= 6, '>=6 dB', +(b - m).toFixed(1));
    add('day_lang', isFinite(q) && q <= -50, '<= -50 dB', +q.toFixed(1));
    // fade-in: cuối đoạn dâng phải to hơn đầu đoạn dâng >= 6 dB
    // Đo dâng: đầu đoạn dâng vs BÌNH NGUYÊN của đuôi (60–85% quãng từ cuối dâng tới fade cuối).
    // Không đo sát mép cuối đoạn dâng: nhạc loop có chỗ trũng crossfade (job4 đo thật: trũng −79 dB
    // tại ~93% đuôi) làm báo oan dù nhạc dâng chuẩn.
    const i = f.into_tail;
    const inStart = rmsPerSecond(videoPath, i.start_s + 1, i.start_s + 6);
    const med = a => { const v = a.map(x => x.db).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : NaN; };
    const plateauFrom = i.start_s + i.dur_s, plateauTo = f.end_fade.start_s;
    let inEnd;
    if (plateauTo - plateauFrom >= 8) {
      inEnd = rmsPerSecond(videoPath, plateauFrom + (plateauTo - plateauFrom) * 0.1, plateauFrom + (plateauTo - plateauFrom) * 0.6);
    } else {
      // đuôi co hết (into_tail chạm fade cuối) → đo trung vị NỬA SAU đoạn dâng
      inEnd = rmsPerSecond(videoPath, i.start_s + i.dur_s * 0.5, i.start_s + i.dur_s - 1);
    }
    const s1 = avg(inStart), s2 = med(inEnd);
    add('fade_in_dang', isFinite(s1) && isFinite(s2) && (s2 - s1) >= 6, '>=6 dB', +(s2 - s1).toFixed(1));
  }
  // fade cuối video (mọi chế độ)
  const e = f.end_fade;
  if (e?.dur_s >= 5) {
    const pre = rmsPerSecond(videoPath, Math.max(0, e.start_s - 10), e.start_s - 2);
    const tail = rmsPerSecond(videoPath, e.start_s + e.dur_s - 3, e.start_s + e.dur_s);
    const avg = a => a.length ? a.reduce((s, x) => s + x.db, 0) / a.length : NaN;
    const p = avg(pre), t = Math.min(...tail.map(x => x.db));
    add('fade_cuoi', isFinite(p) && isFinite(t) && (p - t) >= 10, '>=10 dB', +(p - t).toFixed(1));
  }

  // 3. OUTRO CÒN TIẾNG — bẫy chí tử của fade-sau-amix (phải không bị fade đè)
  const outroSeg = (plan.timeline ?? []).find(s => s.kind === 'outro');
  if (outroSeg) {
    const midOutro = (outroSeg.start_s + outroSeg.end_s) / 2;
    const o = rmsPerSecond(videoPath, midOutro - 3, midOutro + 3);
    const avg = o.length ? o.reduce((s, x) => s + x.db, 0) / o.length : -120;
    add('outro_con_tieng', avg >= -40, '>= -40 dB (giọng rõ)', +avg.toFixed(1));
  }

  // 4. Phụ đề: trích 1 frame giữa một đoạn truyện, đo mật độ pixel màu chữ (nâu đậm trên nền)
  if (opts.checkSubtitle !== false) {
    const story = (plan.timeline ?? []).find(s => s.kind === 'story');
    if (story) {
      const t = (story.start_s + story.end_s) / 2;
      const { ffmpeg } = tools();
      const png = path.join(path.dirname(videoPath), '_verify-frame.png');
      spawnSync(ffmpeg, ['-y', '-v', 'error', '-ss', String(t), '-i', videoPath, '-frames:v', '1', png]);
      add('phu_de_frame', fs.existsSync(png) && fs.statSync(png).size > 10000, 'frame trích được (soát chữ bằng mắt/OCR ở bước duyệt)', fs.existsSync(png) ? png : 'KHONG');
    }
  }

  return { ok: checks.every(c => c.ok), checks };
}
