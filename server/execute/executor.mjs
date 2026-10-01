// executor.mjs — LỚP THỰC THI: kế hoạch (plan.mjs) → compose-spec → chạy compose2.mjs.
// Ghi mốc từng bước vào job_step (DB) để restart chạy tiếp chỗ dở (A3).
// MỘT job một lúc (A5): executor từ chối chạy nếu còn job đang 'rendering'.
import fs from 'node:fs';
import { config, diskRoot } from '../config.mjs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { get, run as dbRun, tx } from '../db/db.mjs';
import { buildMergedSrt } from './subtitle.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPOSE2 = path.join(HERE, 'compose2.mjs');

// ===== fades (giây tuyệt đối, từ plan.mjs) → biểu thức volume ffmpeg trên NHÁNH NHẠC =====
// Hình dạng: 1 → (fade-out) → 0 → (lặng) → 0 → (fade-in) → 1 → ... → (fade cuối) → 0
export function fadesToVolumeExpr(fades) {
  const seg = [];
  if (fades.mode === 'no_tail') {
    const f = fades.end_fade;
    // trước fade: 1; trong fade: giảm tuyến tính về 0
    return `if(lt(t,${f.start_s}),1,max(0,1-(t-${f.start_s})/${f.dur_s}))`;
  }
  const o = fades.out_of_body, s = fades.silence, i = fades.into_tail, e = fades.end_fade;
  // 5 vùng: [0,o.start)=1 · [o.start,s.start)=giảm · [s.start,i.start)=0 · [i.start,i.start+i.dur)=tăng · [.. ,e.start)=1 · còn lại=giảm
  const oEnd = o.start_s + o.dur_s;          // = s.start_s
  const iEnd = i.start_s + i.dur_s;
  return (
    `if(lt(t,${o.start_s}),1,` +
    `if(lt(t,${oEnd}),1-(t-${o.start_s})/${o.dur_s},` +
    `if(lt(t,${i.start_s}),0,` +
    `if(lt(t,${iEnd}),(t-${i.start_s})/${i.dur_s},` +
    `if(lt(t,${e.start_s}),1,` +
    `max(0,1-(t-${e.start_s})/${e.dur_s}))))))`
  );
}

// ===== plan → compose-spec.json =====
// Danh sách shot hình nền phủ ĐÚNG bgEnd giây: lặp base tới khi shot kế tiếp sẽ vượt,
// trả phần dư (rem) + shot kế (next) để cắt một bản -t rem cho khớp tuyệt đối.
export function bgShotList(c, bgEnd) {
  const n = c.shots_base.length, files = [];
  let acc = 0;
  for (let k = 0; k < 200000; k++) {
    const i = k % n, d = c.shots_base_durations[i];
    if (acc + d > bgEnd - 0.05) return { files, rem: Math.round((bgEnd - acc) * 1000) / 1000, next: c.shots_base[i] };
    files.push(c.shots_base[i]); acc += d;
  }
  throw new Error('bgShotList: không hội tụ');
}

// Khoảng nghỉ giữa các đoạn giọng (30/09): timeline đặt đoạn sau cách đoạn trước gapSeconds (mặc định 2s),
// phụ đề + mục lục tính theo timeline đó → audio PHẢI có đúng khoảng lặng ấy, nếu không phụ đề trễ dần
// (lỗi video yPZQnkErniU: chuyện trễ 2s, outro trễ 4s). Hình + nhạc nền vẫn chạy liên tục trong lúc nghỉ.
export function voiceGaps(plan) {
  const v = (plan.timeline ?? []).filter(t => ['hook', 'story', 'outro'].includes(t.kind)).sort((a, b) => a.start_s - b.start_s);
  return v.slice(1).map((t, i) => Math.max(0, Math.round((t.start_s - v[i].end_s) * 1000) / 1000));
}
export function interleaveVoice(files, gaps, gapFile) {
  const out = [];
  files.forEach((f, i) => { out.push(f); if (i < files.length - 1 && gaps[i] > 0.01) out.push(gapFile(gaps[i])); });
  return out;
}

export function planToComposeSpec(plan, { outDir, slug, subtitlePath = null, subtitleStyle = null, tailClips = null, gapFiles = null }) {
  const c = plan.compose;
  const shots = [];
  if (c.black_s > 0) {
    // Màn đen (anh Vũ 30/09): hình nền trước, đen sau; nhạc chạy tiếp liền mạch (một file nhạc -stream_loop).
    if (!tailClips) throw new Error('Thiếu clip đuôi (prerender_tail chưa chạy)');
    const bg = bgShotList(c, c.max_duration_sec - c.black_s);
    shots.push(...bg.files);
    if (tailClips.trim) shots.push(tailClips.trim);
    // 30/09: KHÔNG đưa màn đen vào danh sách shot nữa — compose nén riêng rồi nối không nén lại (spec.black_s)
  } else {
    // không màn đen: giữ nguyên hành vi đã nghiệm thu (loop base đủ số vòng)
    for (let k = 0; k < c.shots_loops; k++) shots.push(...c.shots_base);
  }
  const spec = {
    output: path.join(outDir, slug + '.mp4'),
    workdir: path.join(outDir, '_work', '_compose'),
    aspect: c.aspect, fps: c.fps,
    shots,
    voiceover: gapFiles ? interleaveVoice(c.voiceover_files, voiceGaps(plan), g => gapFiles[g.toFixed(3)]) : c.voiceover_files,
    music: c.music,
    music_gain_db: c.music_gain_db, vo_gain_db: c.vo_gain_db, loudnorm_lufs: c.loudnorm_lufs,
    max_duration_sec: c.max_duration_sec,
    music_volume_expr: fadesToVolumeExpr(plan.fades),
    fast: true, black_s: c.black_s > 0 ? c.black_s : 0, // 30/09: 1 lần nén video, màn đen nối không nén
  };
  if (subtitlePath) { spec.subtitle = subtitlePath; if (subtitleStyle) spec.subtitle_style = subtitleStyle; }
  return spec;
}

// ===== clip đuôi: bản cắt shot kế (khớp phần dư) + khối đen, cùng sig với shot gốc =====
function probeSig(ffprobe, f) {
  const r = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,pix_fmt,r_frame_rate', '-of', 'json', f], { encoding: 'utf8' });
  const st = JSON.parse(r.stdout || '{}').streams?.[0];
  if (!st) throw new Error('Không probe được ' + f);
  return { sig: `${st.codec_name}|${st.width}x${st.height}|${st.pix_fmt}|${st.r_frame_rate}`, st };
}
function probeDur(ffprobe, f) {
  const r = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f], { encoding: 'utf8' });
  return parseFloat(r.stdout);
}
export function prerenderTail(plan, clipDir, { ffmpeg, ffprobe }) {
  const c = plan.compose;
  fs.mkdirSync(clipDir, { recursive: true });
  const ref = probeSig(ffprobe, c.shots_base[0]);
  const { width: w, height: h, pix_fmt: pix, r_frame_rate: fps } = ref.st;
  const venc = ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', pix, '-r', fps];
  const bg = bgShotList(c, c.max_duration_sec - c.black_s);
  const out = { trim: null, black: null, rem: bg.rem, black_s: c.black_s };
  const runF = args => { const r = spawnSync(ffmpeg, ['-y', '-v', 'error', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error('ffmpeg: ' + (r.stderr || '').slice(-300)); };
  if (bg.rem > 0.05) {
    out.trim = path.join(clipDir, 'bg-trim.mp4');
    runF(['-i', bg.next, '-t', String(bg.rem), '-vf', `scale=${w}:${h}`, ...venc, out.trim]);
  }
  for (const f of [out.trim, out.black].filter(Boolean)) {
    const g = probeSig(ffprobe, f).sig;
    if (g !== ref.sig) throw new Error(`Clip đuôi lệch định dạng shot: ${g} ≠ ${ref.sig}`);
  }
  return { ...out, sig: ref.sig, black_dur: c.black_s };
}

// ===== chạy job =====
function step(jobId, name, fn) {
  const existing = get('SELECT * FROM job_step WHERE job_id=? AND name=?', jobId, name);
  if (existing?.status === 'done') return JSON.parse(existing.detail ?? 'null'); // resume: bỏ qua bước xong
  const id = existing?.id ?? dbRun('INSERT INTO job_step (job_id,name,status) VALUES (?,?,?)', jobId, name, 'pending').lastInsertRowid;
  dbRun("UPDATE job_step SET status='running', started_at=datetime('now') WHERE id=?", id);
  try {
    const detail = fn() ?? null;
    dbRun("UPDATE job_step SET status='done', finished_at=datetime('now'), detail=? WHERE id=?", JSON.stringify(detail), id);
    return detail;
  } catch (e) {
    dbRun("UPDATE job_step SET status='failed', finished_at=datetime('now'), detail=? WHERE id=?", JSON.stringify({ error: String(e.message) }), id);
    throw e;
  }
}

export function executeJob(jobId, { outRoot }) {
  // A5: một job một lúc
  const running = get("SELECT id FROM job WHERE status IN ('rendering','uploading') AND id != ?", jobId);
  if (running) throw new Error(`Job ${running.id} đang chạy — quy tắc MỘT job một lúc (anh Vũ 27/09)`);

  const job = get('SELECT * FROM job WHERE id=?', jobId);
  if (!job) throw new Error('Không có job ' + jobId);
  const plan = JSON.parse(job.plan_json);
  const slug = `${job.playlist_id}-job${jobId}`;
  const outDir = path.join(outRoot, slug);
  fs.mkdirSync(outDir, { recursive: true });
  dbRun("UPDATE job SET status='rendering', started_at=COALESCE(started_at, datetime('now')) WHERE id=?", jobId);

  try {
    // Phụ đề BẮT BUỘC (quy tắc anh Vũ 14/09): gộp .srt của từng đoạn giọng theo timeline.
    const sub = step(jobId, 'build_subtitle', () => {
      const r = buildMergedSrt(plan, path.join(outDir, slug + '.srt'));
      if (!r.ok) throw new Error('Không gộp được phụ đề: ' + (r.error ?? '') + ' | thiếu .srt: ' + r.missing.join(', '));
      if (r.missing.length) throw new Error('Thiếu .srt cho: ' + r.missing.join(', '));
      return r;
    });

    const ffmpegPath = (config.ffmpeg || get("SELECT path FROM tool WHERE name='ffmpeg'")?.path || 'ffmpeg');
    const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    const tailClips = plan.compose.black_s > 0
      ? step(jobId, 'prerender_tail', () => prerenderTail(plan, path.join(outDir, '_work', '_clips'), { ffmpeg: ffmpegPath, ffprobe: ffprobePath }))
      : null;

    const gaps = voiceGaps(plan).filter(g => g > 0.01);
    const gapFiles = gaps.length ? step(jobId, 'prerender_gaps', () => {
      const dir = path.join(outDir, '_work', '_clips'); fs.mkdirSync(dir, { recursive: true });
      const pr = spawnSync(ffprobePath, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'json', plan.compose.voiceover_files[0]], { encoding: 'utf8' });
      const st = JSON.parse(pr.stdout || '{}').streams?.[0] ?? {};
      const sr = st.sample_rate || '48000', cl = Number(st.channels) === 1 ? 'mono' : 'stereo';
      const map = {};
      for (const g of [...new Set(gaps.map(x => x.toFixed(3)))]) {
        const f = path.join(dir, `gap-${g}s.wav`);
        const r = spawnSync(ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `anullsrc=r=${sr}:cl=${cl}`, '-t', g, f], { encoding: 'utf8' });
        if (r.status !== 0) throw new Error('Không tạo được khoảng lặng: ' + (r.stderr || '').slice(-200));
        map[g] = f;
      }
      return map;
    }) : null;

    const spec = step(jobId, 'build_spec', () => {
      const s = planToComposeSpec(plan, { outDir, slug, subtitlePath: sub.srt_path, subtitleStyle: plan.subtitle_style ?? null, tailClips, gapFiles });
      const p = path.join(outDir, 'compose-spec.json');
      fs.writeFileSync(p, JSON.stringify(s, null, 1), 'utf8');
      return { spec_path: p, output: s.output };
    });

    step(jobId, 'compose', () => {
      const env = { ...process.env, FFMPEG: (config.ffmpeg || get("SELECT path FROM tool WHERE name='ffmpeg'")?.path || 'ffmpeg'), FFPROBE: ((config.ffmpeg || get("SELECT path FROM tool WHERE name='ffmpeg'")?.path || 'ffmpeg')).replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1') };
      // có khối đen: ép nhánh demuxer+re-encode (stream-copy đòi khớp cả SPS/profile — dễ giật)
      if (plan.compose.black_s > 0) env.COMPOSE_REENC_GB = '0';
      const r = spawnSync(process.execPath, [COMPOSE2, spec.spec_path], { encoding: 'utf8', maxBuffer: 1 << 28, env });
      if (r.status !== 0) throw new Error('compose2 exited ' + r.status + ': ' + (r.stderr ?? '').split('\n').slice(-8).join(' | '));
      return { ok: true };
    });

    dbRun("UPDATE job SET status='verifying', video_path=? WHERE id=?", spec.output, jobId);
    return { ok: true, video: spec.output, outDir };
  } catch (e) {
    dbRun("UPDATE job SET status='failed', error=?, finished_at=datetime('now') WHERE id=?", String(e.message), jobId);
    throw e;
  }
}
