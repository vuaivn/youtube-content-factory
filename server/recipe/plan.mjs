// plan.mjs — LỚP CÔNG THỨC: recipe + tài nguyên → KẾ HOẠCH DỰNG (nguyên tắc N2).
// THUẦN TÍNH TOÁN: không đọc đĩa, không gọi ffmpeg, không đụng DB.
// Caller đưa dữ liệu vào, nhận kế hoạch ra → test được toàn bộ bằng dữ liệu giả.
//
// Đầu vào:
//   recipe  : bản ghi recipe (đã parse body_spec/tail_spec) — xem shape bên dưới
//   assets  : { hooks:[], stories:[], outros:[], shots:[], musics:[] }
//             mỗi phần tử: { id, file_path, title, duration_s, used_count? }
//   opts    : { seed, targetSeconds?, usedIds?: Set<number> }
// Đầu ra: { ok, plan?, errors[] , warnings[] }
//   plan.timeline : các đoạn [{kind, start_s, end_s, source}]
//   plan.fades    : 4 mốc fade đã TÍNH RA GIÂY TUYỆT ĐỐI (áp lên nhánh nhạc)
//   plan.compose  : spec nháp cho compose.mjs (thiếu đường dẫn work/output do caller điền)

// PRNG tự cấy hạt — tái lập được theo seed (mulberry32, đủ tốt cho việc chọn kho)
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rng, items, n, usedIds) {
  // Ưu tiên chưa dùng (used_count 0 / không nằm trong usedIds), sau đó ngẫu nhiên
  const fresh = items.filter(i => !(usedIds?.has(i.id)) && !(i.used_count > 0));
  const pool = fresh.length >= n ? fresh : items.slice(); // hết đồ mới thì cho quay vòng
  const out = [];
  const bag = pool.slice();
  while (out.length < n && bag.length) out.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
  return out;
}

export function buildPlan(recipe, assets, opts = {}) {
  const errors = [], warnings = [];
  const rng = makeRng(opts.seed ?? 1);
  const usedIds = opts.usedIds ?? new Set();

  // ---- 1. Đích thời lượng ----
  const totalTarget = opts.targetSeconds ?? recipe.total_seconds; // podcast: null = tự tính
  const body = recipe.body_spec ?? {};
  const tails = Array.isArray(recipe.tail_spec) ? recipe.tail_spec : [];
  // Đuôi = HAI khối cố định thứ tự (anh Vũ chốt 30/09): hình nền TRƯỚC, màn đen SAU.
  //  - hình nền: số giây TỐI THIỂU; phần dư sau khi bốc truyện rơi vào đây.
  //  - màn đen : đúng số giây nhập. Nhạc chạy tiếp liền mạch (không đổi file).
  // Dữ liệu cũ: 'music_only' = hình nền; seconds không phải số (vd 'conLai') = 0.
  const secOf = t => { const v = t.seconds ?? t.giay; return Number.isFinite(v) ? Math.max(0, v) : 0; };
  const bgMin = tails.filter(t => (t.kind ?? t.kieu) !== 'black').reduce((a, t) => a + secOf(t), 0);
  const blackS = tails.filter(t => (t.kind ?? t.kieu) === 'black').reduce((a, t) => a + secOf(t), 0);
  const tailFixed = bgMin + blackS;
  if (totalTarget && tailFixed >= totalTarget) errors.push(`Đuôi (hình nền ${fmt(bgMin)} + màn đen ${fmt(blackS)}) không nhỏ hơn tổng ${fmt(totalTarget)}`);

  // ---- 2. Chọn giọng đọc: hook + N truyện + outro ----
  const nHook = body.hook === false ? 0 : 1;
  const nOutro = body.outro === false ? 0 : 1;
  const hook = nHook ? pickWeighted(rng, assets.hooks ?? [], 1, usedIds)[0] : null;
  const outro = nOutro ? pickWeighted(rng, assets.outros ?? [], 1, usedIds)[0] : null;
  if (nHook && !hook) errors.push('Kho hook trống');
  if (nOutro && !outro) errors.push('Kho outro trống');

  let stories = [];
  if (body.stories === 'fixed') {
    const n = body.storyCount ?? 1;
    // Chặn dữ liệu bẩn: n phải là số dương — chuỗi kiểu "denKhiDu" từng làm plan
    // lặng lẽ chọn 0 truyện mà không báo lỗi (M6 lần 1, 28/09)
    if (!Number.isInteger(n) || n < 1) {
      errors.push(`body.storyCount không hợp lệ: ${JSON.stringify(n)} — 'đến khi đủ' phải dùng stories:'fill'`);
    } else {
      stories = pickWeighted(rng, assets.stories ?? [], n, usedIds);
      if (stories.length < n) errors.push(`Kho truyện: cần ${n}, chỉ còn ${stories.length}`);
    }
  } else {
    // 'fill': lấp giọng đọc tới max_voice_ratio * tổng
    if (!totalTarget) errors.push("body.stories='fill' cần total_seconds cố định");
    else {
      // ngân sách giọng = tổng − đuôi, và không vượt trần tỉ lệ giọng (Nâng cao)
      const voiceCap = Math.min(totalTarget - tailFixed, (recipe.max_voice_ratio ?? 1) * totalTarget);
      // 30/09: tính CẢ khoảng nghỉ (y như dòng thời gian bước 3: hook+nghỉ, mỗi truyện+nghỉ, outro).
      // Trước đây quên → giọng đọc lố trần ~0,5 phút khi bốc sát ngưỡng (KCNQ 115,1' > 115').
      const g = body.gapSeconds ?? 2;
      const budget = voiceCap - (hook ? hook.duration_s + g : 0) - (outro?.duration_s ?? 0);
      if (budget <= 0) errors.push('Ngân sách giọng đọc <= 0 (hook+outro đã vượt tỉ lệ)');
      const cand = (assets.stories ?? []).slice();
      let sum = 0;
      // chọn dần chưa-dùng-trước, dừng khi thêm truyện kế sẽ vượt ngân sách
      while (cand.length) {
        const pick = pickWeighted(rng, cand, 1, usedIds)[0];
        if (!pick) break;
        cand.splice(cand.indexOf(pick), 1);
        if (sum + pick.duration_s + g > budget) { if (sum > 0) break; }
        stories.push(pick); sum += pick.duration_s + g;
        if (sum >= budget * 0.9) break;
      }
      if (!stories.length) errors.push('Không chọn được truyện nào trong ngân sách giọng đọc');
    }
  }

  // ---- 3. Dòng thời gian giọng đọc ----
  const gap = body.gapSeconds ?? 2;
  let t = 0;
  const timeline = [];
  if (hook) { timeline.push(seg('hook', t, hook)); t += hook.duration_s + gap; }
  for (const s of stories) { timeline.push(seg('story', t, s)); t += s.duration_s + gap; }
  if (outro) { timeline.push(seg('outro', t, outro)); t += outro.duration_s; }
  const voiceEnd = t;

  // ---- 4. Tổng thời lượng + đuôi ----
  let total, tailStart;
  if (totalTarget) {
    total = totalTarget;
    if (voiceEnd + tailFixed > totalTarget + 0.5)
      errors.push(`Giọng đọc ${fmt(voiceEnd)} + đuôi ${fmt(tailFixed)} vượt tổng ${fmt(totalTarget)} — giảm số truyện hoặc phần đuôi`);
    tailStart = voiceEnd;
  } else {
    tailStart = voiceEnd;
    total = voiceEnd + tailFixed;
  }
  const tailLen = total - tailStart;
  if (totalTarget && recipe.kind !== 'podcast') {
    const ratio = voiceEnd / total;
    if (ratio > recipe.max_voice_ratio + 0.05)
      warnings.push(`Tỉ lệ giọng ${(ratio * 100).toFixed(0)}% vượt trần ${(recipe.max_voice_ratio * 100).toFixed(0)}%`);
  }
  const blackStart = total - blackS;
  if (blackStart - tailStart > 0.5) timeline.push({ kind: 'tail:background', start_s: r2(tailStart), end_s: r2(blackStart), source: null });
  if (blackS > 0) timeline.push({ kind: 'tail:black', start_s: r2(blackStart), end_s: r2(total), source: null });

  // ---- 5. BỐN MỐC FADE (neo giây tuyệt đối, áp NHÁNH NHẠC — quy tắc anh Vũ chốt 21:08 27/09) ----
  const F = {
    out_of_body: recipe.fade_out_of_body_s ?? 120,
    silence: recipe.silence_gap_s ?? 3,
    into_tail: recipe.fade_into_tail_s ?? 90,
    end: recipe.fade_end_of_video_s ?? 15,
  };
  let fades;
  if (tailLen <= 0.5) {
    // KHÔNG có đuôi → gộp: chỉ MỘT lần fade cuối video (không fade hai lần)
    const d = Math.max(F.out_of_body, F.end);
    fades = { mode: 'no_tail', end_fade: { start_s: r2(Math.max(0, total - d)), dur_s: d } };
  } else {
    let { out_of_body, silence, into_tail } = F;
    const need = out_of_body + silence + into_tail;
    if (tailLen < need + F.end) {
      // Đuôi ngắn → co theo tỉ lệ (giữ nguyên fade cuối video)
      const k = Math.max(0, (tailLen - F.end)) / need;
      out_of_body = r2(out_of_body * k); silence = r2(silence * k); into_tail = r2(into_tail * k);
      warnings.push(`Đuôi ${fmt(tailLen)} ngắn hơn tổng fade ${fmt(need + F.end)} — co theo tỉ lệ k=${k.toFixed(2)}`);
    }
    // Fade-out bắt đầu SAU khi giọng hết (đo từ GRMzzCA7Mcg: giọng hết → nhạc fade dần
    // → lặng → nhạc dâng). Neo cũ (fade kết thúc TẠI voiceEnd) sai: fade chìm dưới giọng,
    // tai không nghe thấy và RMS tổng không giảm — verify M3 lần 1 bắt được đúng lỗi này.
    fades = {
      mode: 'with_tail',
      out_of_body: { start_s: r2(voiceEnd), dur_s: out_of_body },
      silence: { start_s: r2(voiceEnd + out_of_body), dur_s: silence },
      into_tail: { start_s: r2(voiceEnd + out_of_body + silence), dur_s: into_tail },
      end_fade: { start_s: r2(total - F.end), dur_s: F.end },
    };
  }

  // ---- 6. Hình: chọn base 3–5 phút rồi loop (giữ hành vi đã nghiệm thu của produce.py) ----
  const baseTarget = 180 + rng() * 120;
  const shotPool = (assets.shots ?? []).filter(s => s.duration_s > 0);
  const baseShots = [];
  let baseSum = 0;
  const bag = shotPool.slice();
  while (baseSum < baseTarget && bag.length) {
    const p = bag.splice(Math.floor(rng() * bag.length), 1)[0];
    baseShots.push(p); baseSum += p.duration_s;
  }
  if (baseShots.length < 8) errors.push(`Kho hình: chỉ chọn được ${baseShots.length} clip (cần >= 8)`);
  const loops = baseSum > 0 ? Math.ceil((total * 1.02) / baseSum) : 0;

  // ---- 7. Nhạc ----
  const music = pickWeighted(rng, assets.musics ?? [], 1, usedIds)[0];
  if (!music) errors.push('Kho nhạc trống');

  if (errors.length) return { ok: false, errors, warnings };

  // ---- 8. Spec nháp cho compose.mjs (caller điền output/workdir/subtitle) ----
  const compose = {
    aspect: '16:9', fps: 30,
    shots_base: baseShots.map(s => s.file_path), shots_loops: loops,
    shots_base_durations: baseShots.map(s => s.duration_s),
    black_s: r2(blackS), // >0: executor cắt hình nền đúng tại (total − black_s) rồi nối khối đen
    voiceover_files: [hook, ...stories, outro].filter(Boolean).map(s => s.file_path),
    music: music.file_path,
    music_gain_db: -22, vo_gain_db: 0, loudnorm_lufs: -16,
    max_duration_sec: r2(total),
    // fade truyền xuống dạng cấu trúc — lớp thực thi (M3) dịch sang filter ffmpeg trên nhánh nhạc
    music_fades: fades,
  };

  return {
    ok: true, errors, warnings,
    plan: {
      recipe_id: recipe.id, seed: opts.seed ?? 1,
      total_s: r2(total), voice_end_s: r2(voiceEnd), tail_len_s: r2(tailLen),
      voice_ratio: r2(voiceEnd / total),
      timeline, fades,
      picked: {
        hook: hook?.id ?? null, stories: stories.map(s => s.id),
        outro: outro?.id ?? null, music: music.id, shots: baseShots.map(s => s.id),
      },
      compose,
    },
  };
}

function seg(kind, start, a) { return { kind, start_s: r2(start), end_s: r2(start + a.duration_s), source: { id: a.id, file: a.file_path, title: a.title ?? null } }; }
function r2(x) { return Math.round(x * 100) / 100; }
function fmt(s) { return (s / 60).toFixed(1) + 'ph'; }
