// test-executor.mjs — kiểm fadesToVolumeExpr + planToComposeSpec bằng cách
// TÍNH TAY giá trị biểu thức tại các mốc then chốt (mô phỏng eval của ffmpeg).
import { fadesToVolumeExpr, planToComposeSpec } from '../server/execute/executor.mjs';
import { buildPlan } from '../server/recipe/plan.mjs';

let fail = 0, n = 0;
function ca(name, fn) { n++; try { fn(); console.log('  DAT   ' + name); } catch (e) { fail++; console.log('  TRUOT ' + name + ' -> ' + e.message); } }
function gan(a, b, tol, m) { if (Math.abs(a - b) > tol) throw new Error(`${m}: ${a} != ${b}`); }

// eval biểu thức ffmpeg if(lt(t,X),A,B) bằng JS
function evalExpr(expr, t) {
  const s = expr.replace(/lt\(t,([0-9.]+)\)/g, '(t<$1)').replace(/max\(/g, 'Math.max(').replace(/\bif\(/g, 'IF(');
  const IF = (c, a, b) => (c ? a : b);
  return Function('t', 'IF', 'return ' + s.replace(/IF\(/g, 'IF(') + ';')(t, IF);
}

const mk = (nn, dur, pre) => Array.from({ length: nn }, (_, i) => ({ id: i + 1, file_path: `${pre}${i + 1}.bin`, title: pre + (i + 1), duration_s: dur, used_count: 0 }));
const ASSETS = { hooks: mk(5, 250, 'h'), stories: mk(30, 460, 's'), outros: mk(5, 280, 'o'), shots: mk(60, 8, 'v'), musics: mk(10, 3600, 'm') };
const R4H = { id: 'r', kind: 'hybrid-4h', total_seconds: 14400, max_voice_ratio: 0.55,
  body_spec: { stories: 'fill', gapSeconds: 2 }, tail_spec: [{ kind: 'music_only', seconds: 7200 }],
  fade_out_of_body_s: 120, silence_gap_s: 3, fade_into_tail_s: 90, fade_end_of_video_s: 15 };

const r = buildPlan(R4H, ASSETS, { seed: 42 });
const expr = fadesToVolumeExpr(r.plan.fades);
const f = r.plan.fades, ve = r.plan.voice_end_s;

ca('volume=1 khi đang giọng đọc (t = giữa ruột)', () => gan(evalExpr(expr, ve / 2), 1, 0.001, 'giữa ruột'));
ca('volume=1 ngay TRƯỚC fade-out (outro vẫn nguyên nhạc nền)', () => gan(evalExpr(expr, f.out_of_body.start_s - 1), 1, 0.001, 'trước fade'));
ca('volume=0.5 ở CHÍNH GIỮA fade-out', () => gan(evalExpr(expr, f.out_of_body.start_s + f.out_of_body.dur_s / 2), 0.5, 0.01, 'giữa fade'));
ca('volume=0 trong khoảng lặng', () => gan(evalExpr(expr, f.silence.start_s + f.silence.dur_s / 2), 0, 0.001, 'lặng'));
ca('volume=0.5 giữa fade-in đuôi', () => gan(evalExpr(expr, f.into_tail.start_s + 45), 0.5, 0.01, 'giữa dâng'));
ca('volume=1 giữa đuôi nhạc', () => gan(evalExpr(expr, 10000), 1, 0.001, 'giữa đuôi'));
ca('volume=0 đúng cuối video', () => gan(evalExpr(expr, 14400), 0, 0.001, 'cuối'));

// không đuôi
const RNT = { ...R4H, total_seconds: null, body_spec: { stories: 'fixed', storyCount: 1, gapSeconds: 2 }, tail_spec: [] };
const r2 = buildPlan(RNT, ASSETS, { seed: 5 });
const e2 = fadesToVolumeExpr(r2.plan.fades);
ca('không đuôi: 1 trước fade, 0 ở cuối, KHÔNG tụt giữa chừng', () => {
  gan(evalExpr(e2, r2.plan.total_s * 0.3), 1, 0.001, 'giữa video');
  gan(evalExpr(e2, r2.plan.total_s), 0, 0.001, 'cuối');
});

// planToComposeSpec
ca('spec: shots loop đủ vòng, music_volume_expr có mặt, max_duration khớp', () => {
  const spec = planToComposeSpec(r.plan, { outDir: 'X:/out', slug: 'test' });
  if (spec.shots.length !== r.plan.compose.shots_base.length * r.plan.compose.shots_loops) throw new Error('shots loop sai');
  if (!spec.music_volume_expr) throw new Error('thiếu music_volume_expr');
  gan(spec.max_duration_sec, 14400, 0.01, 'max_duration');
  if (spec.music_fade_out_sec) throw new Error('không được dùng chế độ cũ sau amix');
});

console.log(`\n${n - fail}/${n} ca DAT` + (fail ? '' : ' — EXECUTOR LOGIC CHUAN.'));
process.exit(fail ? 1 : 0);
