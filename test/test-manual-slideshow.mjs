// test-manual-slideshow.mjs - slideshow nhiều khúc (fade/dissolve) → 1 mp4.
// node test/test-manual-slideshow.mjs [imgDir] [outDir]  (không tham số: tự tạo ảnh test bằng ffmpeg lavfi)
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderSlideshow, listImages } from '../server/execute/slideshow.mjs';
import { probeDuration } from '../server/recipe/manual-plan.mjs';

const FF = 'C:/ffmpeg/ffmpeg.exe', FP = 'C:/ffmpeg/ffprobe.exe';
let [dir, out] = process.argv.slice(2);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ycf-ss-'));
out = out || tmp;
if (!dir) {
  dir = path.join(tmp, 'imgs'); fs.mkdirSync(dir);
  const colors = ['red', 'green', 'blue', 'orange', 'purple', 'teal', 'gray', 'yellow'];
  colors.forEach((c, i) => {
    const r = spawnSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=1600x900,drawbox=c=${c}@0.6:t=fill`, '-frames:v', '1', path.join(dir, `${String(i + 1).padStart(2, '0')}.png`)], { encoding: 'utf8' });
    if (r.status) throw new Error('lavfi fail: ' + r.stderr);
  });
}
const N = Math.min(40, listImages(dir).length);
const imgs = listImages(dir).slice(0, N);
const S = 3, dur = 30;
const t0 = Date.now();
const r = renderSlideshow({ images: imgs, secPerImage: S, width: 1280, height: 720, duration: dur, order: 'sorted', workDir: out, outPath: path.join(out, 'ss.mp4'), seed: 42, log: () => {} });
const p = spawnSync(FP, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', r.path], { encoding: 'utf8' }).stdout.trim();
const d = probeDuration(r.path);
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
ok(fs.existsSync(r.path), 'mp4 tồn tại');
ok(p.startsWith('1280,720'), 'kích thước 1280x720 (' + p + ')');
ok(d >= dur - 0.5, `thời lượng ${d}s >= ${dur}s`);
console.log(JSON.stringify({ images_in: imgs.length, dur: d, secs: (Date.now() - t0) / 1000 }));
if (!process.argv[2]) fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} FAIL` : 'ALL PASS');
process.exit(fail ? 1 : 0);
