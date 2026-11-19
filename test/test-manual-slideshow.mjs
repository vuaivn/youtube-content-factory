// test-manual-slideshow.mjs - slideshow nhiều khúc (40 ảnh × 3s) → 1 mp4. node test/test-manual-slideshow.mjs <imgDir> <outDir>
import { renderSlideshow, listImages } from '../server/execute/slideshow.mjs';
import { probeDuration } from '../server/recipe/manual-plan.mjs';
import { spawnSync } from 'node:child_process';
const [dir, out] = process.argv.slice(2);
const imgs = listImages(dir).slice(0, 40);
const dur = 40 * 3 - 39 * 1 + 2 * 1; // ~ đủ 40 ảnh (khúc 15/15/10, nối thẳng giữa khúc)
const t0 = Date.now();
const r = renderSlideshow({ images: imgs, secPerImage: 3, width: 1280, height: 720, duration: dur, order: 'sorted', workDir: out, outPath: out + '/ss40.mp4', log: console.log });
const p = spawnSync('C:/ffmpeg/ffprobe.exe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,nb_frames', '-of', 'compact', r.path], { encoding: 'utf8' }).stdout.trim();
console.log(JSON.stringify({ ...r, images_in: imgs.length, probe: p, dur: probeDuration(r.path), secs: (Date.now() - t0) / 1000 }));
