// validate.mjs — CỔNG CHẶN trước khi tạo job (bước C trong luồng một-engine §4).
// Chạy TRƯỚC buildPlan: đủ tài nguyên chưa dùng? đủ đĩa? công cụ ngoài có thật?
// App cũ chạy rồi mới chết giữa đường — app mới chặn ở đây, chưa tốn một giây render.
import fs from 'node:fs';
import { config, diskRoot } from '../config.mjs';

// Ước lượng đĩa cần cho một video (đo thật 27/09: video 4h CRF 25 ≈ 4 GB,
// concat + file cuối cùng tồn tại ≈ 2x, cộng 1 GB đệm theo lệnh anh Vũ).
const GB = 1073741824;
export function estimateDiskNeedGB(totalSeconds) {
  // M6 28/09: heuristic cu (1.35 GB/h) TRUOT vi concat stream-copy giu bitrate
  // nguon -> 8 GB thay vi 4. Compose2 gio ep re-encode khi nguon >5 GB, nhung
  // uoc luong van phai du: concat ~1.35xh + mixed.flac ~0.25xh + file cuoi ~1.35xh
  const h = totalSeconds / 3600;
  return h * (1.35 + 0.25 + 1.35) + 1.5;
}

export function freeDiskGB(root = diskRoot()) {
  try { const s = fs.statfsSync(root); return s.bavail * s.bsize / GB; } catch { return null; }
}

/**
 * checkResources(recipe, assets, opts) — thuần tính, không đọc đĩa.
 * assets như buildPlan. Trả { ok, errors[], warnings[], detail{} }.
 */
export function checkResources(recipe, assets, opts = {}) {
  const errors = [], warnings = [];
  const usedIds = opts.usedIds ?? new Set();
  const fresh = arr => (arr ?? []).filter(a => !usedIds.has(a.id) && !(a.used_count > 0));
  const d = {
    hooks: { total: (assets.hooks ?? []).length, fresh: fresh(assets.hooks).length },
    stories: { total: (assets.stories ?? []).length, fresh: fresh(assets.stories).length },
    outros: { total: (assets.outros ?? []).length, fresh: fresh(assets.outros).length },
    shots: { total: (assets.shots ?? []).length },
    musics: { total: (assets.musics ?? []).length },
  };
  const body = recipe.body_spec ?? {};

  if (body.hook !== false && d.hooks.total === 0) errors.push('Kho hook trống');
  if (body.outro !== false && d.outros.total === 0) errors.push('Kho outro trống');
  if (d.musics.total === 0) errors.push('Kho nhạc trống');
  if (d.shots.total < 8) errors.push(`Kho hình chỉ có ${d.shots.total} clip (cần >= 8)`);

  // Truyện: cần bao nhiêu?
  let need;
  if (body.stories === 'fixed') need = body.storyCount ?? 1;
  else {
    // 'fill': ước bằng thời lượng trung bình truyện
    const avg = avgDur(assets.stories);
    const budget = recipe.max_voice_ratio * (recipe.total_seconds ?? 0);
    need = avg > 0 && budget > 0 ? Math.ceil(budget / avg * 0.8) : 1;
  }
  if (d.stories.total < need) errors.push(`Kho truyện: cần ~${need}, tổng chỉ có ${d.stories.total}`);
  else if (d.stories.fresh < need)
    warnings.push(`Kho truyện: cần ~${need} nhưng chỉ còn ${d.stories.fresh} CHƯA DÙNG — sẽ quay vòng đồ cũ`);
  if (body.hook !== false && d.hooks.fresh === 0 && d.hooks.total > 0)
    warnings.push('Hook đã dùng hết một vòng — quay vòng');

  return { ok: errors.length === 0, errors, warnings, detail: d, need_stories: need };
}

/** checkSystem(totalSeconds, tools) — phần CÓ đụng đĩa, caller gọi riêng. */
export function checkSystem(totalSeconds, tools = {}) {
  const errors = [], warnings = [];
  const needGB = estimateDiskNeedGB(totalSeconds);
  const free = freeDiskGB(diskRoot());
  if (free != null && free < needGB)
    errors.push(`Đĩa C: còn ${free.toFixed(1)} GB, cần ~${needGB.toFixed(1)} GB — DỪNG (quy tắc không để C: dưới 1.5 GB)`);
  for (const [name, p] of Object.entries(tools)) {
    if (!p) { errors.push(`Thiếu đường dẫn công cụ '${name}'`); continue; }
    if (p !== 'python' && !fs.existsSync(p)) errors.push(`Công cụ '${name}' không tồn tại: ${p}`);
  }
  return { ok: errors.length === 0, errors, warnings, need_gb: needGB, free_gb: free };
}

function avgDur(arr) {
  const v = (arr ?? []).map(a => a.duration_s).filter(x => x > 0);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
}
