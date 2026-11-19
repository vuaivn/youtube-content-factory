// manual-style.mjs - phụ đề video thủ công (11/2026): kiểm tham số, xuất .ass theo ĐÚNG độ phân giải ra
// (PlayResX/Y = W×H → cỡ chữ tính bằng pixel của video thật), mẫu đã lưu (data/sub-presets.json).
// Kiểu phụ đề cũ (styles.mjs, cỡ 8-48 theo PlayRes mặc định 384x288) GIỮ NGUYÊN cho recipe.
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT } from '../config.mjs';
import { SUB_FONTS } from './styles.mjs';
import { parseSrt } from '../execute/subtitle.mjs';

export const ASPECTS = { vertical: [1080, 1920], horizontal: [1920, 1080], square: [1080, 1080] };
export const QUALITY = { '1080': 1, '720': 2 / 3 };
export const aspectSize = (a, q = '1080') => { const s = ASPECTS[a]; const k = QUALITY[String(q)]; if (!k) throw new Error('Chất lượng: 1080|720'); if (!s) throw new Error('Khung hình không hợp lệ: ' + a + ' (vertical|horizontal|square)'); return { width: Math.round(s[0] * k / 2) * 2, height: Math.round(s[1] * k / 2) * 2, scale: k }; };
/** Co kiểu phụ đề theo chất lượng (cỡ/viền/lề nhập theo khung 1080) để nhìn y hệt. */
export const scaleSub = (st, k) => k === 1 ? st : { ...st, size: Math.max(10, Math.round(st.size * k)), outline: Math.round(st.outline * k * 10) / 10, marginV: Math.round(st.marginV * k) };
const HEX = /^#[0-9A-Fa-f]{6}$/;
const POS = { bottom: 2, middle: 5, top: 8 };
export const DEFAULT_SUB = { font: 'Arial', size: 64, color: '#FFFFFF', outlineColor: '#000000', outline: 3, box: false, boxOpacity: 0.5, position: 'bottom', marginV: 120, bold: false };

export function validateManualSub(p = {}) {
  const s = { ...DEFAULT_SUB, ...p };
  if (!SUB_FONTS.includes(s.font)) throw new Error('Font phụ đề không có trong danh sách: ' + s.font);
  const n = (v, lo, hi, k) => { const x = Number(v); if (!isFinite(x) || x < lo || x > hi) throw new Error(`${k}: ${lo}-${hi}`); return x; };
  if (!HEX.test(s.color) || !HEX.test(s.outlineColor)) throw new Error('Màu dạng #RRGGBB');
  if (!POS[s.position]) throw new Error('Vị trí: bottom|middle|top');
  return { font: s.font, size: Math.round(n(s.size, 10, 220, 'Cỡ chữ')), color: s.color.toUpperCase(), outlineColor: s.outlineColor.toUpperCase(),
    outline: n(s.outline, 0, 20, 'Độ dày viền'), box: !!s.box, boxOpacity: n(s.boxOpacity, 0, 1, 'Độ đậm hộp'), position: s.position,
    marginV: Math.round(n(s.marginV, 0, 1000, 'Khoảng cách dọc')), bold: !!s.bold };
}

const bgr = h => h.slice(5, 7) + h.slice(3, 5) + h.slice(1, 3);
const assColor = (h, alpha = 0) => '&H' + Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase() + bgr(h);
const assTime = t => { t = Math.max(0, t); const cs = Math.round(t * 100); const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
// Chuyển định dạng SRT -> ASS override: <font color="#RRGGBB"> -> {\c&HBBGGRR&}, </font> -> trả màu trước (stack),
// <b>/<i>/<u>/<s> -> \b1.. ; giữ nguyên block {\...} có sẵn; bỏ tag lạ; '{' '}' rời bị bỏ, '\' rời -> '＼'.
export function srtLineToAss(l) {
  const out = []; const colors = [];
  const re = /(\{\\[^}]*\})|<\s*(\/?)\s*([a-zA-Z]+)([^>]*)>|([\s\S])/g; let m; let txt = '';
  const flush = () => { if (txt) { out.push(txt.replace(/[{}]/g, '').replace(/\\/g, '＼')); txt = ''; } };
  while ((m = re.exec(l))) {
    if (m[1]) { flush(); out.push(m[1]); continue; }
    if (m[5] !== undefined) { txt += m[5]; continue; }
    flush();
    const close = !!m[2], tag = m[3].toLowerCase(), attr = m[4] || '';
    if (tag === 'font') {
      if (!close) {
        const c = /color\s*=\s*["']?#?([0-9a-fA-F]{6})/i.exec(attr);
        colors.push(c ? c[1].toUpperCase() : null);
        if (c) out.push(`{\\c&H${bgr('#' + c[1].toUpperCase())}&}`);
      } else if (colors.length) {
        const was = colors.pop();
        if (was) { const prev = [...colors].reverse().find(Boolean); out.push(prev ? `{\\c&H${bgr('#' + prev)}&}` : '{\\c}'); }
      }
    } else if (['b', 'i', 'u', 's'].includes(tag)) out.push(`{\\${tag}${close ? 0 : 1}}`);
    // tag khác: bỏ
  }
  flush();
  return out.join('');
}
const assText = lines => lines.map(srtLineToAss).join('\\N');

export function buildAss(cues, style, W, H) {
  const s = validateManualSub(style);
  const boxA = 1 - s.boxOpacity; // ASS alpha: 0=đặc
  const outC = s.box ? assColor(s.outlineColor, boxA) : assColor(s.outlineColor);
  const back = s.box ? assColor(s.outlineColor, boxA) : '&H80000000';
  const mh = Math.round(W * 0.06);
  const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\nScaledBorderAndShadow: yes\nYCbCr Matrix: TV.709\n\n` +
    `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Default,${s.font},${s.size},${assColor(s.color)},&H000000FF,${outC},${back},${s.bold ? -1 : 0},0,0,0,100,100,0,0,${s.box ? 3 : 1},${s.box ? Math.max(s.outline, 8) : s.outline},0,${POS[s.position]},${mh},${mh},${s.marginV},1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return '\uFEFF' + head + cues.map(c => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${assText(c.lines)}`).join('\n') + '\n';
}
export function srtToAss(srtPath, assPath, style, W, H) {
  fs.writeFileSync(assPath, buildAss(parseSrt(fs.readFileSync(srtPath, 'utf8')), style, W, H), 'utf8');
  return assPath;
}

// ===== mẫu phụ đề đã lưu =====
const PRESETS = path.join(APP_ROOT, 'data', 'sub-presets.json');
export function listPresets() {
  try { return JSON.parse(fs.readFileSync(PRESETS, 'utf8').replace(/^\uFEFF/, '')).presets ?? []; } catch { return []; }
}
export function savePreset({ id, name, style }) {
  name = String(name ?? '').trim(); if (!name) throw new Error('Thiếu tên mẫu');
  const st = validateManualSub(style);
  const list = listPresets();
  const pid = id && list.some(p => p.id === id) ? id : 'sp-' + Date.now().toString(36);
  const rec = { id: pid, name, style: st, updated_at: new Date().toISOString() };
  const i = list.findIndex(p => p.id === pid); if (i >= 0) list[i] = rec; else list.push(rec);
  fs.mkdirSync(path.dirname(PRESETS), { recursive: true });
  fs.writeFileSync(PRESETS + '.tmp', JSON.stringify({ presets: list }, null, 1), 'utf8');
  fs.renameSync(PRESETS + '.tmp', PRESETS);
  return rec;
}
export function deletePreset(id) {
  const list = listPresets().filter(p => p.id !== id);
  fs.writeFileSync(PRESETS, JSON.stringify({ presets: list }, null, 1), 'utf8');
  return { deleted: true };
}
