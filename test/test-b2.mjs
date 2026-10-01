// test-b2.mjs — Bước 2: công thức hình nền + màn đen.
// Phần A: logic plan.mjs (dữ liệu giả). Phần B (--render): dựng THẬT video ngắn có màn đen và đo.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPlan } from '../server/recipe/plan.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  DAT   ' : '  TRUOT ') + m); };
const mk = (pre, n, d) => Array.from({ length: n }, (_, i) => ({ id: pre * 1000 + i, file_path: `${pre}-${i}.mp3`, duration_s: typeof d === 'function' ? d(i) : d }));
const assets = { hooks: mk(1, 5, 240), outros: mk(2, 5, 240), stories: mk(3, 60, i => 600 + (i % 7) * 60), shots: mk(4, 40, 8), musics: mk(5, 3, 600) };
const base = { id: 't', kind: 'hybrid-4h', max_voice_ratio: 0.55, fade_out_of_body_s: 120, silence_gap_s: 3, fade_into_tail_s: 90, fade_end_of_video_s: 15 };

console.log('== A. logic công thức');
{ // theo app cũ: tổng 240', hình nền tối thiểu 5', đen 120', fill
  const r = buildPlan({ ...base, total_seconds: 14400, body_spec: { stories: 'fill', gapSeconds: 2 }, tail_spec: [{ kind: 'background', seconds: 300 }, { kind: 'black', seconds: 7200 }] }, assets, { seed: 7 });
  const p = r.plan, bg = p.timeline.find(x => x.kind === 'tail:background'), bk = p.timeline.find(x => x.kind === 'tail:black');
  ok(r.ok && p.total_s === 14400, 'app cũ: tổng đúng 14400s');
  ok(bk && bk.start_s === 7200 && bk.end_s === 14400, 'màn đen đúng 120 phút ở CUỐI');
  ok(bg && bg.start_s === p.voice_end_s && bg.end_s === 7200 && bg.end_s - bg.start_s >= 300, `hình nền TRƯỚC đen, ≥5 phút (thực ${((bg.end_s - bg.start_s) / 60).toFixed(1)}')`);
  ok(p.compose.black_s === 7200 && p.compose.shots_base_durations.length === p.compose.shots_base.length, 'compose mang black_s + thời lượng shot');
  ok(p.fades.end_fade.start_s === 14385 && p.fades.out_of_body.start_s === p.voice_end_s, 'fade: ra khỏi giọng ngay khi giọng hết, fade cuối ở 14385s (trong đen, nhạc vẫn chạy)');
}
{ // cố định n truyện, không nhập tổng → tổng = giọng + nền + đen
  const r = buildPlan({ ...base, kind: 'podcast', total_seconds: null, body_spec: { stories: 'fixed', storyCount: 2, gapSeconds: 2 }, tail_spec: [{ kind: 'background', seconds: 300 }, { kind: 'black', seconds: 3600 }] }, assets, { seed: 3 });
  ok(r.ok && r.plan.picked.stories.length === 2 && Math.abs(r.plan.total_s - (r.plan.voice_end_s + 3900)) < 0.01, 'cố định 2 truyện + nền 5\' + đen 60\': tổng = giọng + 65\'');
}
{ // đuôi vượt tổng → chặn
  const r = buildPlan({ ...base, total_seconds: 3600, body_spec: { stories: 'fill' }, tail_spec: [{ kind: 'background', seconds: 600 }, { kind: 'black', seconds: 3600 }] }, assets, { seed: 1 });
  ok(!r.ok && r.errors.some(e => e.includes('không nhỏ hơn tổng')), 'đuôi ≥ tổng → từ chối, báo rõ');
}
{ // cố định quá nhiều truyện so với tổng → chặn (không âm thầm nới video)
  const r = buildPlan({ ...base, total_seconds: 3600, body_spec: { stories: 'fixed', storyCount: 10 }, tail_spec: [{ kind: 'black', seconds: 600 }] }, assets, { seed: 1 });
  ok(!r.ok && r.errors.some(e => e.includes('vượt tổng')), 'giọng + đuôi vượt tổng → từ chối');
}
{ // dữ liệu cũ 'conLai' + music_only vẫn chạy như trước
  const r = buildPlan({ ...base, total_seconds: 14400, body_spec: { stories: 'fill' }, tail_spec: [{ kind: 'music_only', seconds: 'conLai' }] }, assets, { seed: 7 });
  ok(r.ok && r.plan.compose.black_s === 0 && !r.plan.timeline.some(x => x.kind === 'tail:black'), 'dữ liệu cũ (conLai) → không đen, hành vi cũ');
}

if (process.argv.includes('--render')) {
  console.log('== B. dựng THẬT video ngắn có màn đen');
  const { get, all, run } = await import('../server/db/db.mjs');
  const { executeJob } = await import('../server/execute/executor.mjs');
  const story = get("SELECT id,file_path,title,duration_s FROM asset WHERE pool_id='jataka-qta' AND status='active' ORDER BY duration_s LIMIT 1");
  const shots = all("SELECT id,file_path,duration_s FROM asset WHERE pool_id='phat-giao-ru-ngu-shots' AND status='active' AND duration_s>0 LIMIT 60");
  const music = all("SELECT id,file_path,duration_s FROM asset WHERE pool_id='music-main' AND status='active' LIMIT 5");
  const r = buildPlan({ ...base, kind: 'podcast', total_seconds: null, body_spec: { hook: false, outro: false, stories: 'fixed', storyCount: 1 }, tail_spec: [{ kind: 'background', seconds: 60 }, { kind: 'black', seconds: 120 }] },
    { hooks: [], outros: [], stories: [story], shots, musics: music }, { seed: 11 });
  if (!r.ok) { console.log(r.errors); process.exit(1); }
  const p = r.plan; const blackStart = p.total_s - 120;
  const jobId = run("INSERT INTO job (playlist_id,status,plan_json) VALUES ('pqta-podcast','queued',?)", JSON.stringify(p)).lastInsertRowid;
  const outRoot = 'C:/tmp/ycf-b2';
  const t0 = Date.now();
  let res, err = null;
  try { res = executeJob(jobId, { outRoot }); } catch (e) { err = e.message; }
  console.log(`  render ${((Date.now() - t0) / 60000).toFixed(1)} phút · job ${jobId}`);
  ok(!err, 'executeJob chạy xong' + (err ? ': ' + err : ''));
  if (!err) {
    const ffmpeg = get("SELECT path FROM tool WHERE name='ffmpeg'").path, ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    const dur = parseFloat(spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', res.video], { encoding: 'utf8' }).stdout);
    ok(Math.abs(dur - p.total_s) < 1, `thời lượng ${dur.toFixed(1)}s (kế hoạch ${p.total_s}s)`);
    const luma = t => { const o = spawnSync(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', res.video, '-frames:v', '1', '-vf', 'scale=1:1,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 }); return o.stdout[0]; };
    const before = luma(blackStart - 5), after = luma(blackStart + 5), end = luma(p.total_s - 3);
    ok(before > 20, `5s TRƯỚC màn đen có hình (độ sáng ${before})`);
    ok(after <= 20 && end <= 20, `5s SAU và cuối video là đen (độ sáng ${after}, ${end})`);
    const log = fs.readFileSync(path.join(res.outDir, '_work', '_compose', 'compose.log'), 'utf8');
    ok(/fast mode: 1 lan nen video/.test(log) && /am thanh song song xong/.test(log), 'compose chạy chế độ nhanh: 1 lần nén hình, đen nối không nén, âm thanh song song');
    const vol = t => { const o = spawnSync(ffmpeg, ['-v', 'info', '-ss', String(t), '-t', '4', '-i', res.video, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }); return parseFloat((o.stderr.match(/mean_volume: (-?[\d.]+)/) || [])[1]); };
    // đo ở 80% đoạn nhạc dâng (fade-in) — điểm này phải nằm TRONG màn đen, ngoài khoảng lặng
    const ti = p.fades.into_tail, tm = ti.start_s + ti.dur_s * 0.8;
    ok(tm > blackStart + 4, `điểm đo ${tm.toFixed(1)}s nằm trong màn đen (bắt đầu ${blackStart.toFixed(1)}s)`);
    const vb = vol(tm - 2);
    ok(vb > -50, `nhạc vẫn chạy trong màn đen (mean ${vb} dB tại ${tm.toFixed(0)}s)`);
  }
  // dọn: xoá video thử + job thử (không để rác DB/đĩa)
  run('DELETE FROM job_step WHERE job_id=?', jobId); run('DELETE FROM job WHERE id=?', jobId);
  fs.rmSync(outRoot, { recursive: true, force: true });
  console.log('  đã dọn job thử + ' + outRoot);
}
console.log(`\n${pass} DAT / ${fail} TRUOT`);
process.exit(fail ? 1 : 0);
