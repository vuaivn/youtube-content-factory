import fs from 'node:fs'; import { spawnSync } from 'node:child_process';
import { buildAss, validateManualSub } from '../server/recipe/manual-style.mjs';
import { parseSrt } from '../server/execute/subtitle.mjs';
const O = 'C:/Users/Administrator/aicoworker/openclaw/workspace-main-agents/projects/ycf-manual-test/';
const cues = parseSrt(fs.readFileSync('C:/ycf-work/manual-out/job119/video.srt','utf8')).filter(c => c.start <= 46.5 && c.end >= 46.5).map(c => ({ ...c, start: 0, end: 10 }));
const extra = process.argv[3] ? [{ start: 0, end: 10, lines: process.argv[3].split('|') }] : cues;
const img = 'D:/data/picture/Hình Thầy Từ Thông 169/' + (process.argv[4] || '87.png');
for (const [n, st] of [['A', { box: false }], ['B', { box: true }]]) {
  const ass = `C:/ycf-work/pv-${n}.ass`; fs.writeFileSync(ass, buildAss(extra, validateManualSub(st), 1920, 1080));
  const r = spawnSync('C:/ffmpeg/ffmpeg.exe', ['-y','-v','error','-i',img,'-frames:v','1','-q:v','3','-vf',`scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,ass='C\\:/ycf-work/pv-${n}.ass'`, O + `sub-${n}${process.argv[2]||''}.jpg`], { encoding: 'utf8' });
  console.log(n, r.status, r.stderr);
}
