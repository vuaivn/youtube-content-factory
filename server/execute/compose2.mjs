#!/usr/bin/env node
// video-compose: assemble a finished video from shots + VO + music (+ subs/chapters).
// Resume-safe: every intermediate output is skipped if it already exists (unless --force).
// Usage: node compose.mjs <compose-spec.json> [--force] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync, spawn } from 'node:child_process';

const args = process.argv.slice(2);
const specPath = args.find(a => !a.startsWith('--'));
const FORCE = args.includes('--force');
const DRY = args.includes('--dry-run');
if (!specPath) { console.error('usage: node compose.mjs <compose-spec.json> [--force] [--dry-run]'); process.exit(2); }

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const specDir = path.dirname(path.resolve(specPath));
const resolve = p => (p == null ? null : (path.isAbsolute(p) ? p : path.resolve(specDir, p)));

const OUT = resolve(spec.output); if (!OUT) die('spec.output required');
const WORK = resolve(spec.workdir || path.join(path.dirname(OUT), '_compose'));
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const ASPECT = spec.aspect || '16:9';
const TARGET = ASPECT === '9:16' ? { w: 720, h: 1280 } : { w: 1280, h: 720 };
const FPS = spec.fps || 30;
const LUFS = spec.loudnorm_lufs ?? -16;
// Bitrate: crf 22 cho file 6,6 Mbps o 720p — cao gap 2,6 lan muc YouTube can (2,5 Mbps).
// crf 25 cho file nho hon ~30% ma mat khong phan biet duoc voi video hinh tinh.
// Dia chi co 13,7 GB nen kich thuoc file quyet dinh viec chay duoc hay khong.
const CRF = String(process.env.COMPOSE_CRF || spec.crf || 25);
const MUSIC_DB = spec.music_gain_db ?? -18;
const VO_DB = spec.vo_gain_db ?? 0;

// ===== BO CANH O DIA chay SONG SONG =====
// compose.mjs goi ffmpeg bang spawnSync (dong bo) nen khong tu kiem dia giua chung
// duoc. Bo canh nay chay rieng, cu 5 giay kiem mot lan, xuong duoi 1,5 GB thi
// dung ffmpeg ngay. Lenh anh Vu: tuyet doi khong de o C duoi 1 GB.
let _boCanh = null;
function batDauCanhDia() {
  if (DRY) return;
  try {
    const script = path.join(import.meta.dirname, 'canh-dia.mjs');
    if (!fs.existsSync(script)) return;
    _boCanh = spawn(process.execPath, [script, WORK, '1.5'], { stdio: 'ignore', detached: false });
    _boCanh.unref?.();
  } catch {}
}
function dungCanhDia() { try { _boCanh?.kill('SIGTERM'); } catch {} }
process.on('exit', dungCanhDia);
process.on('SIGINT', () => { dungCanhDia(); process.exit(130); });

const LOG = path.join(WORK, 'compose.log');
function log(m) { const line = `[${new Date().toISOString()}] ${m}`; console.log(line); try { fs.appendFileSync(LOG, line + '\n'); } catch {} }
function die(m) { log('FATAL ' + m); process.exit(1); }
function run(bin, a) {
  log(`$ ${bin} ${a.join(' ')}`);
  if (DRY) return '';
  const r = spawnSync(bin, a, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { log((r.stderr || '').split('\n').slice(-25).join('\n')); die(`${bin} exited ${r.status}`); }
  return (r.stderr || '') + (r.stdout || '');
}
function probe(file, entries) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries,
    '-of', 'default=noprint_wrappers=1:nokey=0', file], { encoding: 'utf8' });
  const o = {}; (r.stdout || '').trim().split('\n').forEach(l => { const i = l.indexOf('='); if (i > 0) o[l.slice(0, i)] = l.slice(i + 1); });
  return o;
}
function durOf(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return parseFloat((r.stdout || '0').trim()) || 0;
}
function has(f) { return f && fs.existsSync(f) && fs.statSync(f).size > 0; }
function skip(f, name) { if (has(f) && !FORCE) { log(`SKIP ${name} (exists: ${path.basename(f)})`); return true; } return false; }

// ---- gather shots ----
let shots = [];
if (Array.isArray(spec.shots)) shots = spec.shots.map(resolve);
else if (spec.shots && spec.shots.dir) {
  const dir = resolve(spec.shots.dir);
  const re = spec.shots.pattern ? new RegExp(spec.shots.pattern) : /\.mp4$/i;
  shots = fs.readdirSync(dir).filter(f => re.test(f)).sort().map(f => path.join(dir, f));
  if (spec.shots.limit) shots = shots.slice(0, spec.shots.limit);
}
shots = shots.filter(has);
if (!shots.length) die('no shots found');
log(`shots: ${shots.length}`);

// ---- STEP 1: concat shots ----
batDauCanhDia();

const concatMp4 = path.join(WORK, 'concat.mp4');

// ===== CANH DIA + DON FILE TAM =====
// Anh Vu chot: tuyet doi khong de o C xuong duoi 1 GB, va file tam dung xong
// phai xoa ngay. Truoc day compose.mjs KHONG co mot lenh xoa nao -> concat.mp4
// (3,2 GB) + mixed.wav (1,4 GB) + vo.wav (757 MB) cung ton tai toi cuoi.
function diaTrongGB() {
  try { const s = fs.statfsSync(path.parse(path.resolve(OUT)).root); return s.bavail * s.bsize / 1073741824; }
  catch { return null; }
}
/** Xoa file tam ngay khi khong con dung. Khong bao gio nem loi. */
function donNgay(dsFile, viSao) {
  let tha = 0;
  for (const f of dsFile) {
    if (!f) continue;
    try { const sz = fs.statSync(f).size; fs.unlinkSync(f); tha += sz; } catch {}
  }
  if (tha > 0) log(`don ngay ${(tha / 1048576).toFixed(0)} MB (${viSao}) -> dia con ${(diaTrongGB() ?? 0).toFixed(2)} GB`);
  return tha;
}
/** Chan truoc khi chay lenh nang: neu khong du cho thi DUNG, khong de ffmpeg ghi toi khi can. */
function canDuCho(canGB, viec) {
  const con = diaTrongGB();
  if (con == null) return;
  if (con < canGB + 1.0) {   // +1 GB dem an toan theo lenh anh Vu
    throw new Error(
      `[DIA] Khong du cho cho buoc "${viec}": can ~${canGB.toFixed(1)} GB + 1 GB dem, ` +
      `o dia chi con ${con.toFixed(2)} GB. DUNG de khong lam can o C.`);
  }
}
// ===== CHẾ ĐỘ NHANH (30/09) =====
// Trước: nén lại cả 4h HAI lần (ghép shot ~57' + in phụ đề ~2h, kể cả 2h màn đen).
// Giờ: video chỉ nén MỘT lần và chỉ phần có hình (ghép + chuẩn hoá + phụ đề cùng lúc);
// màn đen nén riêng bằng đúng thông số rồi NỐI KHÔNG NÉN LẠI (như app cũ produce-hybrid-4h).
const FAST = spec.fast === true;
const BLACK_S = FAST ? Number(spec.black_s || 0) : 0;
const listFile = path.join(WORK, 'concat-list.txt');
if (FAST) {
  if (!(spec.max_duration_sec > 0)) die('fast mode can max_duration_sec');
  const sigs0 = shots.map(s => { const p = probe(s, 'stream=codec_name,width,height,pix_fmt,r_frame_rate'); return `${p.codec_name}|${p.width}x${p.height}|${p.pix_fmt}|${p.r_frame_rate}`; });
  if (!sigs0.every(x => x === sigs0[0])) die('fast mode: shot khong dong nhat dinh dang — can demuxer');
  fs.writeFileSync(listFile, shots.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  log(`fast mode: 1 lan nen video, hinh ${(spec.max_duration_sec - BLACK_S).toFixed(1)}s + den ${BLACK_S}s (noi khong nen)`);
}
if (!FAST && !skip(concatMp4, 'concat')) {
  // detect uniformity of codec/dimensions/fps/pix_fmt
  const sigs = shots.map(s => { const p = probe(s, 'stream=codec_name,width,height,pix_fmt,r_frame_rate'); return `${p.codec_name}|${p.width}x${p.height}|${p.pix_fmt}|${p.r_frame_rate}`; });
  const uniform = sigs.every(x => x === sigs[0]);
  // Stream-copy giu nguyen bitrate nguon: 4h shot goc = ~8 GB (M6 28/09 chet vi vay).
  // Neu tong size nguon vuot nguong -> van dung concat demuxer (1 input) nhung
  // RE-ENCODE CRF thay vi -c:v copy. TUYET DOI KHONG di nhanh filter_complex
  // cho hang nghin file: 1836 input mo cung luc lam ffmpeg chet (M6 job9 28/09).
  const sumGB = shots.reduce((s, f) => s + (fs.existsSync(f) ? fs.statSync(f).size : 0), 0) / 1073741824;
  const REENC_NGUONG_GB = Number(process.env.COMPOSE_REENC_GB || 5);
  const reencUniform = uniform && sumGB > REENC_NGUONG_GB;
  log(`concat mode: ${uniform ? (reencUniform ? 'demuxer+re-encode' : 'stream-copy') : 'filter re-encode'} (sig=${sigs[0]}, nguon ${sumGB.toFixed(1)} GB)`);
  fs.writeFileSync(listFile, shots.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  if (uniform) {
    // KHONG +faststart o buoc concat: ghi lai lan 2 = can gap doi cho (bai hoc 27/09)
    // -vf khi re-encode: "uniform" chi nghia la cac shot GIONG NHAU, chua chac
    // khop TARGET (kho 1080p dong nhat -> concat 1080p to + mux cuoi encode lan 3)
    const vArgs = reencUniform
      ? ['-vf', `scale=${TARGET.w}:${TARGET.h}:force_original_aspect_ratio=decrease,pad=${TARGET.w}:${TARGET.h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p`,
         '-c:v', 'libx264', '-crf', CRF, '-preset', 'veryfast', '-pix_fmt', 'yuv420p']
      : ['-c:v', 'copy'];
    run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-an', ...vArgs, concatMp4]);
  } else {
    // TODO (advisor 28/09): nhanh nay mo TAT CA input cung luc — se chet nhu job 9
    // neu >~vai tram shot khong dong nhat. Phai thay bang normalize-tung-shot roi
    // concat demuxer. Kho hien tai dong nhat nen chua cham toi.
    if (shots.length > 400) throw new Error(`filter_complex voi ${shots.length} input se lam ffmpeg chet (job 9). Kho shot khong dong nhat + qua nhieu file — can normalize tung shot truoc.`);
    // filter_complex concat with per-input normalization (scale/pad to target, fps, sar, pix_fmt)
    const ins = []; shots.forEach(s => { ins.push('-i', s); });
    const parts = shots.map((_, i) =>
      `[${i}:v]scale=${TARGET.w}:${TARGET.h}:force_original_aspect_ratio=decrease,` +
      `pad=${TARGET.w}:${TARGET.h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p[v${i}]`).join(';');
    const cc = shots.map((_, i) => `[v${i}]`).join('') + `concat=n=${shots.length}:v=1:a=0[vout]`;
    run(FFMPEG, ['-y', ...ins, '-filter_complex', `${parts};${cc}`, '-map', '[vout]',
      '-c:v', 'libx264', '-crf', CRF, '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', concatMp4]);
  }
}
const shotsDur = FAST ? Number(spec.max_duration_sec) : durOf(concatMp4);
// Cho phep CAT dung thoi luong mong muon (che do podcast: duoi nhac phai dung 2 phut,
// khong bi keo dai theo do dai ngau nhien cua chuoi hinh lap).
const CAP = Number(spec.max_duration_sec || 0);
const totalDur = (CAP > 0 && CAP < shotsDur) ? CAP : shotsDur;
if (CAP > 0 && CAP < shotsDur) log(`cat bot hinh: ${shotsDur.toFixed(1)}s -> ${totalDur.toFixed(1)}s (theo max_duration_sec)`);
log(`total video duration: ${totalDur.toFixed(2)}s`);

// ---- STEP 2: concat VO blocks ----
let voWav = null;
const voList = [].concat(spec.voiceover || spec.vo || []).map(resolve).filter(has);
if (voList.length) {
  voWav = path.join(WORK, 'vo.wav');
  if (!skip(voWav, 'vo-concat')) {
    if (voList.length === 1) {
      run(FFMPEG, ['-y', '-i', voList[0], '-ac', '2', '-ar', '48000', voWav]);
    } else {
      const ins = []; voList.forEach(v => { ins.push('-i', v); });
      const cc = voList.map((_, i) => `[${i}:a]`).join('') + `concat=n=${voList.length}:v=0:a=1[a]`;
      run(FFMPEG, ['-y', ...ins, '-filter_complex', cc, '-map', '[a]', '-ac', '2', '-ar', '48000', voWav]);
    }
  }
}

// ---- STEP 3: mix music (looped) ducked under VO ----
const music = resolve(spec.music);
// FLAC thay WAV: ~2,7 GB -> ~1 GB cho 4h, ffmpeg mux nhan truc tiep (advisor 28/09)
const mixedWav = path.join(WORK, 'mixed.flac');
let audioTrack = null;
if (has(music) || voWav) {
  audioTrack = mixedWav;
  if (!skip(mixedWav, 'mix')) {
    // ===== FADE NHÁNH NHẠC (app mới — thay music_fade_out_sec cũ) =====
    // spec.music_volume_expr: biểu thức volume theo t, áp RIÊNG lên nhạc SAU sidechain.
    // KHÔNG áp sau amix — outro dài 234-306s sẽ bị tắt tiếng (bài học 27/09).
    // Vẫn nhận music_fade_out_sec cũ để tương thích (áp sau amix như trước).
    const FADE = Number(spec.music_fade_out_sec || 0);
    const fadeFilter = FADE > 0
      ? `,afade=t=out:st=${Math.max(0, totalDur - FADE).toFixed(2)}:d=${FADE}`
      : '';
    if (FADE > 0) log(`music fade-out (che do cu, sau amix): ${FADE}s cuoi`);
    const MVEXPR = spec.music_volume_expr || null;   // ví dụ: 'if(lt(t,100),1,...)'
    const mFade = MVEXPR ? `volume='${MVEXPR}':eval=frame,` : '';
    if (MVEXPR) log(`music fade (nhanh nhac): ${MVEXPR.slice(0, 120)}...`);

    if (has(music) && voWav) {
      // loop music to cover full video, duck under VO via sidechaincompress, then mix VO on top
      run(FFMPEG, ['-y', '-stream_loop', '-1', '-i', music, '-i', voWav,
        '-filter_complex',
        `[0:a]volume=${MUSIC_DB}dB,aformat=sample_rates=48000:channel_layouts=stereo[m];` +
        `[1:a]volume=${VO_DB}dB,aformat=sample_rates=48000:channel_layouts=stereo,apad[vo];` +
        `[vo]asplit=2[vosc][vomix];` +
        `[m][vosc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[mduck];` +
        `[mduck]${mFade}anull[mfaded];` +
        `[mfaded][vomix]amix=inputs=2:duration=first:dropout_transition=0${fadeFilter}[aout]`,
        '-map', '[aout]', '-t', String(totalDur), '-ac', '2', '-ar', '48000', mixedWav]);
    } else if (has(music)) {
      run(FFMPEG, ['-y', '-stream_loop', '-1', '-i', music,
        '-filter_complex', `[0:a]volume=${MUSIC_DB}dB,aformat=sample_rates=48000:channel_layouts=stereo,${mFade}anull${fadeFilter}[aout]`,
        '-map', '[aout]', '-t', String(totalDur), '-ac', '2', '-ar', '48000', mixedWav]);
    } else {
      run(FFMPEG, ['-y', '-i', voWav, '-af', `volume=${VO_DB}dB,apad`, '-t', String(totalDur), '-ac', '2', '-ar', '48000', mixedWav]);
    }
  }
}

// ---- chapters metadata ----
let metaFile = null;
if (Array.isArray(spec.chapters) && spec.chapters.length) {
  metaFile = path.join(WORK, 'chapters.ffmeta');
  let m = ';FFMETADATA1\n';
  const ch = spec.chapters;
  for (let i = 0; i < ch.length; i++) {
    const start = Math.round((ch[i].time || 0) * 1000);
    const end = Math.round(((i + 1 < ch.length ? ch[i + 1].time : totalDur)) * 1000);
    m += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${start}\nEND=${end}\ntitle=${ch[i].title || 'Chapter ' + (i + 1)}\n`;
  }
  fs.writeFileSync(metaFile, m);
}

// ---- build final video filter chain: aspect normalization (if needed) THEN subtitles ----
function escSub(p) { return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'"); }
const vfParts = [];
// enforce target aspect if the concatenated video doesn't already match it
if (FAST) vfParts.push(`scale=${TARGET.w}:${TARGET.h}:force_original_aspect_ratio=decrease`,
  `pad=${TARGET.w}:${TARGET.h}:(ow-iw)/2:(oh-ih)/2`, 'setsar=1', `fps=${FPS}`, 'format=yuv420p');
const cdims = FAST ? { width: TARGET.w, height: TARGET.h } : probe(concatMp4, 'stream=width,height');
if (parseInt(cdims.width) !== TARGET.w || parseInt(cdims.height) !== TARGET.h) {
  log(`aspect: concat ${cdims.width}x${cdims.height} != target ${TARGET.w}x${TARGET.h} -> scale/pad`);
  vfParts.push(`scale=${TARGET.w}:${TARGET.h}:force_original_aspect_ratio=decrease`,
    `pad=${TARGET.w}:${TARGET.h}:(ow-iw)/2:(oh-ih)/2`, 'setsar=1');
}
const sub = resolve(spec.subtitle || spec.subtitles);
if (has(sub)) {
  if (/\.ass$/i.test(sub)) vfParts.push(`ass='${escSub(sub)}'`);
  else {
    // .srt with brown-cream portrait template (matches workspace video.py)
    const style = spec.subtitle_style ||
      'FontName=Arial,FontSize=16,PrimaryColour=&H00223A5A,OutlineColour=&H00DDECF3,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=60';
    vfParts.push(`subtitles='${escSub(sub)}':force_style='${style}'`);
  }
}
// vo.wav da duoc tron vao mixed.wav -> khong con dung
if (audioTrack && voWav && fs.existsSync(audioTrack) && fs.existsSync(voWav)) {
  donNgay([voWav], 'vo.wav da tron vao mixed.wav');
}

const vf = vfParts.length ? vfParts.join(',') : null;

// ===== KIEM TOAN VEN TRUOC KHI BO QUA =====
// Loi nguy hiem: neu ffmpeg bi giet giua buoc mux (vd bo canh dia dung no),
// file OUT nam do DO DANG. Lan chay sau skip() thay "file ton tai" -> bo qua
// -> pipeline UPLOAD VIDEO HONG. Te hon ca het dia.
// Nen: kiem thoi luong thuc, thieu qua thi xoa di lam lai.
function toanVen(file, canGiay) {
  if (!fs.existsSync(file)) return false;
  try {
    if (fs.statSync(file).size < 1024) return false;
    const d = durOf(file);
    if (!isFinite(d) || d <= 0) return false;
    if (canGiay > 0 && d < canGiay - 2) {
      log(`file do dang: ${path.basename(file)} chi ${d.toFixed(1)}s / can ${canGiay.toFixed(1)}s -> xoa lam lai`);
      try { fs.unlinkSync(file); } catch {}
      return false;
    }
    return true;
  } catch { return false; }
}

// ---- STEP 4: final mux + loudnorm (single pass) + faststart ----
if (!FORCE && toanVen(OUT, totalDur)) { log('DONE (file cuoi da co va DU thoi luong)'); dungCanhDia(); process.exit(0); }
if (FAST) {
  const VENC = ['-c:v', 'libx264', '-crf', CRF, '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(FPS)];
  const frontDur = totalDur - BLACK_S;
  const front = path.join(WORK, 'front.mp4');
  // Âm thanh: loudnorm (chậm ~4-5x thời gian thực) chạy SONG SONG với nén hình — kết quả y như trước
  const audioAac = path.join(WORK, 'audio.m4a');
  let audioJob = null;
  if (audioTrack && !toanVen(audioAac, totalDur - 1)) {
    const aa = ['-y', '-i', audioTrack, '-af', `loudnorm=I=${LUFS}:TP=-1.5:LRA=11`, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-t', totalDur.toFixed(3), audioAac];
    log(`$ (song song) ${FFMPEG} ${aa.join(' ')}`);
    audioJob = new Promise((res, rej) => {
      const p = spawn(FFMPEG, aa, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = ''; p.stderr.on('data', d => { err = (err + d).slice(-4000); });
      p.on('close', c => c === 0 ? res() : rej(new Error('audio loudnorm exited ' + c + ': ' + err.split('\n').slice(-8).join(' | '))));
    });
    audioJob.catch(() => {});
  }
  if (!toanVen(front, frontDur)) {
    canDuCho(frontDur / 3600 * 1.6, 'nen phan hinh');
    run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-an', '-t', frontDur.toFixed(3), '-vf', vf, ...VENC, front]);
  }
  let video = front;
  if (BLACK_S > 0) {
    const black = path.join(WORK, 'black.mp4');
    if (!toanVen(black, BLACK_S))
      run(FFMPEG, ['-y', '-f', 'lavfi', '-i', `color=c=black:s=${TARGET.w}x${TARGET.h}:r=${FPS}`, '-t', String(BLACK_S), '-an', ...VENC, black]);
    video = path.join(WORK, 'video.mp4');
    const jl = path.join(WORK, 'join-list.txt');
    fs.writeFileSync(jl, [front, black].map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    if (!toanVen(video, totalDur)) run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', jl, '-c', 'copy', video]);
    const vd = durOf(video);
    if (Math.abs(vd - totalDur) > 2) die(`noi hinh+den lech: ${vd.toFixed(1)}s / can ${totalDur.toFixed(1)}s`);
    donNgay([front, black], 'da noi hinh + den');
  }
  if (audioJob) { const t0 = Date.now(); try { await audioJob; } catch (e) { die(e.message); } log(`am thanh song song xong (cho them ${((Date.now() - t0) / 1000).toFixed(0)}s)`); }
  const fa = ['-y', '-i', video];
  if (audioTrack) fa.push('-i', audioAac);
  if (metaFile) fa.push('-i', metaFile);
  fa.push('-map', '0:v:0', '-c:v', 'copy');
  if (audioTrack) fa.push('-map', '1:a:0', '-c:a', 'copy');
  if (metaFile) fa.push('-map_metadata', String(audioTrack ? 2 : 1));
  fa.push('-t', totalDur.toFixed(3), OUT);
  canDuCho(fs.statSync(video).size / 1073741824 * 1.1, 'mux cuoi (copy hinh)');
  run(FFMPEG, fa);
  dungCanhDia();
  log(`DONE (fast) -> ${OUT} (${durOf(OUT).toFixed(1)}s)`);
  if (fs.existsSync(OUT) && fs.statSync(OUT).size > 0) donNgay([video !== front ? video : null, front, audioTrack, audioAac], 'da co file cuoi');
  process.exit(0);
}
const inputs = ['-i', concatMp4];
if (audioTrack) inputs.push('-i', audioTrack);
if (metaFile) inputs.push('-i', metaFile);
const a = ['-y', ...inputs];
// PRESET veryfast, KHONG ultrafast: M6 job10 (28/09) do duoc ultrafast phinh
// file cuoi len 10 GB (concat veryfast cung CRF chi 2,8 GB) -> can sach o C,
// ffmpeg chet khong ghi duoc moov atom. ultrafast nen kem ~3-4 lan veryfast.
if (vf) { a.push('-vf', vf, '-c:v', 'libx264', '-crf', CRF, '-preset', 'veryfast', '-pix_fmt', 'yuv420p'); }
else { a.push('-c:v', 'copy'); }
a.push('-map', '0:v:0');
if (audioTrack) { a.push('-map', '1:a:0', '-af', `loudnorm=I=${LUFS}:TP=-1.5:LRA=11`, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k'); }
if (metaFile) { a.push('-map_metadata', String(audioTrack ? 2 : 1)); }
// KHONG dung +faststart mac dinh: no bat ffmpeg ghi xong roi GHI LAI LAN HAI
// de chuyen moov atom len dau -> can GAP DOI dung luong (~6 GB nua cho video 4h).
// Dem 27/09 chet dung o dong 'Starting second pass: moving the moov atom'.
// YouTube tai ve roi NEN LAI toan bo nen moov o dau hay cuoi deu khong anh huong;
// faststart chi co ich khi phat truc tiep tu file qua web server.
const FASTSTART = process.env.COMPOSE_FASTSTART === '1' || spec.faststart === true;
if (FASTSTART) { log('dung +faststart (CAN GAP DOI dung luong)'); a.push('-movflags', '+faststart'); }
a.push('-shortest', OUT);

// Chan truoc: file cuoi thuong co cham nhu concat.mp4 (co phu de thi hon chut).
// Neu khong du cho thi DUNG NGAY, khong de ffmpeg ghi toi khi o dia can kiet.
try {
  const szConcat = fs.existsSync(concatMp4) ? fs.statSync(concatMp4).size / 1073741824 : 0;
    // He so 1.15 la SAI: burn phu de phai nen lai toan bo -> file cuoi to gan
  // GAP DOI concat.mp4 (do: concat 3,1 GB -> file cuoi 6,0 GB). Dung 2.0.
  canDuCho(szConcat * (FASTSTART ? 4.0 : 2.0), 'mux cuoi' + (FASTSTART ? ' + faststart' : ''));
} catch (e) { log(String(e.message)); throw e; }

run(FFMPEG, a);
dungCanhDia();
log(`DONE -> ${OUT} (${durOf(OUT).toFixed(1)}s)`);

// File cuoi da ghi xong -> concat.mp4 va mixed.wav khong con dung
if (fs.existsSync(OUT) && fs.statSync(OUT).size > 0) {
  donNgay([concatMp4, audioTrack], 'da co file cuoi');
}
