// test-plan.mjs — bộ ca thử M2: toàn dữ liệu GIẢ, không đụng DB/đĩa/ffmpeg.
// Mỗi ca kiểm bằng SỐ, thoát mã 1 nếu bất kỳ ca nào trượt.
import { buildPlan, makeRng } from '../server/recipe/plan.mjs';
import { checkResources } from '../server/recipe/validate.mjs';

let fail = 0, caN = 0;
function ca(name, fn) {
  caN++;
  try { fn(); console.log('  DAT   ' + name); }
  catch (e) { fail++; console.log('  TRUOT ' + name + '  -> ' + e.message); }
}
function eq(a, b, m) { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
function gan(a, b, tol, m) { if (Math.abs(a - b) > tol) throw new Error(`${m}: ${a} != ${b} (±${tol})`); }
function that(c, m) { if (!c) throw new Error(m); }

// ---- dữ liệu giả ----
const mk = (n, dur, pre) => Array.from({ length: n }, (_, i) => ({ id: i + 1, file_path: `${pre}${i + 1}.bin`, title: pre + (i + 1), duration_s: dur, used_count: 0 }));
const ASSETS = {
  hooks: mk(5, 250, 'hook'),      // hook ~4ph (thực tế 4.1ph)
  stories: mk(30, 460, 'story'),  // truyện ~7.7ph
  outros: mk(5, 280, 'outro'),    // outro ~4.7ph (thực tế 234-306s)
  shots: mk(60, 8, 'shot'),       // clip 8s
  musics: mk(10, 3600, 'music'),
};
const R4H = {
  id: 'sleep-4h', kind: 'hybrid-4h', total_seconds: 14400, max_voice_ratio: 0.55,
  body_spec: { stories: 'fill', gapSeconds: 2 },
  tail_spec: [{ kind: 'music_only', seconds: 7200 }],
  fade_out_of_body_s: 120, silence_gap_s: 3, fade_into_tail_s: 90, fade_end_of_video_s: 15,
};

// ============ CA 1: video 4 giờ chuẩn ============
ca('4h: tổng đúng 14400s, giọng <= 55%+overshoot 1 truyện', () => {
  const r = buildPlan(R4H, ASSETS, { seed: 42 });
  that(r.ok, 'phải ok: ' + r.errors);
  eq(r.plan.total_s, 14400, 'tổng');
  that(r.plan.voice_end_s <= 14400 * 0.55 + 460, 'giọng vượt trần quá 1 truyện: ' + r.plan.voice_end_s);
  that(r.plan.voice_end_s >= 14400 * 0.35, 'giọng quá ít: ' + r.plan.voice_end_s);
});
ca('4h: 4 mốc fade đúng số + đúng vị trí (fade NHÁNH NHẠC)', () => {
  const r = buildPlan(R4H, ASSETS, { seed: 42 });
  const f = r.plan.fades;
  eq(f.mode, 'with_tail', 'mode');
  eq(f.out_of_body.dur_s, 120, 'fade ra khỏi ruột');
  eq(f.silence.dur_s, 3, 'khoảng lặng');
  eq(f.into_tail.dur_s, 90, 'fade vào đuôi');
  eq(f.end_fade.dur_s, 15, 'fade cuối');
  const ve = r.plan.voice_end_s;
  // Neo đúng theo GRMzzCA7Mcg: giọng hết → nhạc fade dần → lặng → nhạc dâng
  // (neo cũ "fade kết thúc tại voiceEnd" bị verify M3 render thật bác: fade chìm dưới giọng)
  gan(f.out_of_body.start_s, ve, 0.01, 'fade-out BẮT ĐẦU lúc giọng hết');
  gan(f.silence.start_s, ve + 120, 0.01, 'lặng sau khi fade xong');
  gan(f.into_tail.start_s, ve + 120 + 3, 0.01, 'fade-in sau khoảng lặng');
  gan(f.end_fade.start_s, 14400 - 15, 0.01, 'fade cuối video');
});
ca('4h: cùng seed → cùng kế hoạch (tái lập); khác seed → khác', () => {
  const a = buildPlan(R4H, ASSETS, { seed: 7 }), b = buildPlan(R4H, ASSETS, { seed: 7 }), c = buildPlan(R4H, ASSETS, { seed: 8 });
  eq(JSON.stringify(a.plan.picked), JSON.stringify(b.plan.picked), 'seed 7 tái lập');
  that(JSON.stringify(a.plan.picked) !== JSON.stringify(c.plan.picked), 'seed khác phải khác');
});

// ============ CA 2: podcast (tự tính thời lượng) ============
const RPOD = { ...R4H, id: 'podcast', kind: 'podcast', total_seconds: null,
  body_spec: { stories: 'fixed', storyCount: 1, gapSeconds: 2 },
  tail_spec: [{ kind: 'music_only', seconds: 120 }] };
ca('podcast: tổng = giọng + 120s đuôi, đúng 1 truyện', () => {
  const r = buildPlan(RPOD, ASSETS, { seed: 3 });
  that(r.ok, 'phải ok: ' + r.errors);
  eq(r.plan.picked.stories.length, 1, 'số truyện');
  gan(r.plan.total_s, r.plan.voice_end_s + 120, 0.01, 'tổng = giọng + đuôi');
});
ca('podcast: đuôi 120s NGẮN hơn tổng fade (120+3+90+15) → co tỉ lệ, fade cuối giữ 15s', () => {
  const r = buildPlan(RPOD, ASSETS, { seed: 3 });
  const f = r.plan.fades;
  eq(f.mode, 'with_tail', 'mode');
  const k = (120 - 15) / (120 + 3 + 90);
  gan(f.out_of_body.dur_s, 120 * k, 0.5, 'out co theo k');
  gan(f.into_tail.dur_s, 90 * k, 0.5, 'in co theo k');
  eq(f.end_fade.dur_s, 15, 'fade cuối GIỮ NGUYÊN');
  that(r.warnings.some(w => /co theo tỉ lệ/.test(w)), 'phải có cảnh báo co');
});

// ============ CA 3: không có đuôi → fade MỘT lần (câu anh Vũ hỏi 21:08) ============
const RNOTAIL = { ...RPOD, id: 'no-tail', tail_spec: [] };
ca('không đuôi: chỉ MỘT fade cuối video, dài max(120,15)=120', () => {
  const r = buildPlan(RNOTAIL, ASSETS, { seed: 5 });
  that(r.ok, 'phải ok: ' + r.errors);
  const f = r.plan.fades;
  eq(f.mode, 'no_tail', 'mode');
  eq(f.end_fade.dur_s, 120, 'độ dài gộp');
  gan(f.end_fade.start_s, r.plan.total_s - 120, 0.01, 'neo cuối video');
  that(!f.out_of_body && !f.into_tail, 'không được có fade đôi');
});

// ============ CA 4: thiếu tài nguyên → chặn TRƯỚC, lỗi gọi tên đúng kho ============
ca('kho truyện trống → validate bắt + plan từ chối', () => {
  const A = { ...ASSETS, stories: [] };
  const v = checkResources(R4H, A);
  that(!v.ok && v.errors.some(e => /truyện/.test(e)), 'validate phải nêu kho truyện');
  const r = buildPlan(R4H, A, { seed: 1 });
  that(!r.ok && r.errors.some(e => /truyện/.test(e)), 'plan phải từ chối');
});
ca('kho hình 5 clip (<8) → chặn', () => {
  const A = { ...ASSETS, shots: mk(5, 8, 'shot') };
  const v = checkResources(R4H, A);
  that(!v.ok && v.errors.some(e => /hình/.test(e)), 'validate phải nêu kho hình');
});
ca('truyện đã dùng hết → CẢNH BÁO quay vòng (không chặn)', () => {
  const A = { ...ASSETS, stories: ASSETS.stories.map(s => ({ ...s, used_count: 1 })) };
  const v = checkResources(R4H, A);
  that(v.ok, 'vẫn ok');
  that(v.warnings.some(w => /quay vòng/.test(w)), 'phải cảnh báo quay vòng');
});

// ============ CA 5: chống lặp — usedIds bị né ============
ca('usedIds: truyện đã dùng không được chọn lại khi còn đồ mới', () => {
  const used = new Set([1, 2, 3, 4, 5]);
  const r = buildPlan(R4H, ASSETS, { seed: 9, usedIds: used });
  that(r.ok, 'phải ok');
  for (const id of r.plan.picked.stories) that(!used.has(id), 'chọn lại truyện đã dùng: ' + id);
});

// ============ CA 6: timeline liền mạch — không chồng, không thủng ============
ca('timeline: các đoạn giọng nối nhau đúng gap 2s, đuôi khớp cuối giọng', () => {
  const r = buildPlan(R4H, ASSETS, { seed: 11 });
  const segs = r.plan.timeline.filter(s => !s.kind.startsWith('tail'));
  for (let i = 1; i < segs.length; i++)
    gan(segs[i].start_s, segs[i - 1].end_s + 2, 0.01, `đoạn ${i} phải cách đoạn trước đúng 2s`);
  const tail = r.plan.timeline.find(s => s.kind.startsWith('tail'));
  gan(tail.start_s, r.plan.voice_end_s, 0.01, 'đuôi bắt đầu lúc giọng hết');
  gan(tail.end_s, r.plan.total_s, 0.01, 'đuôi kết thúc lúc video hết');
});

console.log(`\n${caN - fail}/${caN} ca DAT` + (fail ? ` — ${fail} TRUOT` : ' — M2 LOGIC CHUAN.'));
process.exit(fail ? 1 : 0);
