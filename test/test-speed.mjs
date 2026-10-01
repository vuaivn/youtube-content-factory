// test-speed.mjs — dựng THẬT 1 video 4h (không upload) bằng chế độ nhanh, đo thời gian + kiểm khớp nối (30/09).
// Chạy khi server đang chạy (lấy kế hoạch qua API). node test/test-speed.mjs [playlist]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const { get, run } = await import('../server/db/db.mjs');
const { executeJob } = await import('../server/execute/executor.mjs');
const { verifyVideo } = await import('../server/execute/verify.mjs');
const PL = process.argv[2] || 'alta-sleep-4h';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  DAT   ' : '  TRUOT ') + m); };
const r = await (await fetch(`http://127.0.0.1:18990/api/playlist/${PL}/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
if (!r.ok) { console.log('plan lỗi', r.errors); process.exit(1); }
const plan = r.plan;
const jobId = run("INSERT INTO job (playlist_id,status,plan_json) VALUES (?, 'queued', ?)", PL, JSON.stringify(plan)).lastInsertRowid;
const outRoot = 'C:/tmp/ycf-speed';
const t0 = Date.now(); let res, err;
try { res = executeJob(jobId, { outRoot }); } catch (e) { err = e.message; }
const mins = (Date.now() - t0) / 60000;
console.log(`  DỰNG ${mins.toFixed(1)} phút · job ${jobId} · voice hết ${(plan.voice_end_s / 60).toFixed(1)}' · đen ${plan.compose.black_s}s`);
ok(!err, 'dựng xong' + (err ? ': ' + err : ''));
if (!err) {
  const v = verifyVideo(res.video, plan, { subtitlePath: res.subtitle ?? null });
  for (const c of v.checks ?? []) ok(c.ok, `${c.name}: ${c.actual} (chuẩn ${c.expected})`);
  const ffmpeg = get("SELECT path FROM tool WHERE name='ffmpeg'").path;
  const bright = t => { const o = spawnSync(ffmpeg, ['-v', 'info', '-ss', String(t), '-i', res.video, '-frames:v', '1', '-vf', 'signalstats,metadata=print', '-f', 'null', '-'], { encoding: 'utf8' }).stderr; return parseFloat((o.match(/YAVG=([\d.]+)/) || [])[1]); };
  const seam = plan.compose.max_duration_sec - plan.compose.black_s;
  const b1 = bright(seam - 3), b2 = bright(seam + 3), b3 = bright(seam + 3600);
  ok(b1 > 20 && b2 < 20 && b3 < 20, `khớp nối ${seam}s: trước ${b1} · sau ${b2} · giữa đen ${b3}`);
  const vol = t => parseFloat((spawnSync(ffmpeg, ['-v', 'info', '-ss', String(t), '-t', '4', '-i', res.video, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/mean_volume: (-?[\d.]+)/) || [])[1]);
  const m1 = vol(seam - 6), m2 = vol(seam + 2);
  ok(m1 > -60 && m2 > -60 && Math.abs(m1 - m2) < 6, `nhạc liền qua khớp nối: ${m1} dB → ${m2} dB`);
  ok(fs.statSync(res.video).size / 1073741824 < 6, `file ${(fs.statSync(res.video).size / 1073741824).toFixed(2)} GB`);
}
run("UPDATE job SET status='cancelled', error='test-speed' WHERE id=?", jobId);
fs.rmSync(outRoot, { recursive: true, force: true });
console.log(`\n${pass} DAT / ${fail} TRUOT · ${mins.toFixed(1)} phút`);
process.exit(fail ? 1 : 0);
