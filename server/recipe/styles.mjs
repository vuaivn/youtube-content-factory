// styles.mjs — kiểu chữ thumbnail + kiểu phụ đề (08/10/2026).
// Mọi thông số đi thẳng vào chuỗi filter ffmpeg → KIỂM BẰNG DANH SÁCH TRẮNG (chống vỡ filter / chèn tham số).
import path from 'node:path';
import { config, APP_ROOT } from '../config.mjs';

const WINF = 'C:/Windows/Fonts/';
// Font thumbnail (drawtext dùng file .ttf): mã → đường dẫn
export const THUMB_FONTS = {
  times: { name: 'Times New Roman đậm', file: () => config.thumbnailFont },
  arial: { name: 'Arial đậm', file: () => WINF + 'arialbd.ttf' },
  tahoma: { name: 'Tahoma đậm', file: () => WINF + 'tahomabd.ttf' },
  segoe: { name: 'Segoe UI đậm', file: () => WINF + 'segoeuib.ttf' },
  dancing: { name: 'Dancing Script (thư pháp mềm)', file: () => path.join(APP_ROOT, 'assets/fonts/DancingScript.ttf') },
  pacifico: { name: 'Pacifico (thư pháp đậm)', file: () => path.join(APP_ROOT, 'assets/fonts/Pacifico.ttf') },
};
// Font phụ đề (libass tìm theo TÊN font đã cài trên Windows)
export const SUB_FONTS = ['Arial', 'Tahoma', 'Times New Roman', 'Segoe UI', 'Verdana'];
export const LAYOUTS = { band: 'Dải nền ngang phía dưới', center: 'Chữ lớn giữa ảnh', left: 'Khung bên trái' };

const COLOR = /^(#[0-9A-Fa-f]{6}|white|black|yellow)$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const int = (v, lo, hi, k) => { const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${k}: số nguyên ${lo}–${hi}`); return n; };
const num = (v, lo, hi, k) => { const n = Number(v); if (!isFinite(n) || n < lo || n > hi) throw new Error(`${k}: ${lo}–${hi}`); return n; };
const col = (v, k) => { if (!COLOR.test(String(v))) throw new Error(`${k}: màu dạng #RRGGBB`); return String(v); };
const three = (v, f, k) => { if (!Array.isArray(v) || v.length !== 3) throw new Error(`${k}: cần 3 giá trị`); return v.map((x, i) => f(x, `${k}[${i + 1}]`)); };

/** Kiểm + chuẩn hoá thông số. Ném lỗi tiếng Việt nếu sai. */
export function validateParams(kind, p) {
  if (!p || typeof p !== 'object') throw new Error('Thiếu thông số');
  if (kind === 'thumb') {
    if (!THUMB_FONTS[p.font]) throw new Error('Font không có trong danh sách');
    if (!LAYOUTS[p.layout]) throw new Error('Bố cục không hợp lệ');
    return {
      font: p.font, layout: p.layout,
      box_color: col(p.box_color ?? 'black', 'Màu nền'), box_alpha: num(p.box_alpha ?? 0, 0, 1, 'Độ đậm nền'),
      colors: three(p.colors, col, 'Màu chữ'), sizes: three(p.sizes, (x, k) => int(x, 12, 160, k), 'Cỡ chữ'),
      borders: three(p.borders, (x, k) => int(x, 0, 10, k), 'Viền'), border_color: col(p.border_color ?? 'black', 'Màu viền'),
      border_alpha: three(p.border_alpha, (x, k) => num(x, 0, 1, k), 'Độ đậm viền'), shadow: p.shadow ? 1 : 0,
    };
  }
  if (kind === 'subtitle') {
    if (!SUB_FONTS.includes(p.font)) throw new Error('Font phụ đề không có trong danh sách');
    if (!HEX.test(String(p.primary)) || !HEX.test(String(p.outline_color))) throw new Error('Màu dạng #RRGGBB');
    return {
      font: p.font, size: int(p.size, 8, 48, 'Cỡ chữ'), primary: p.primary, outline_color: p.outline_color,
      outline_alpha: int(p.outline_alpha ?? 0, 0, 255, 'Độ trong viền'), outline: int(p.outline, 0, 8, 'Độ dày viền'),
      box: p.box ? 1 : 0, margin_v: int(p.margin_v, 0, 200, 'Khoảng cách đáy'), bold: p.bold ? 1 : 0,
    };
  }
  throw new Error('Loại kiểu không hợp lệ');
}

// ===== Thumbnail → chuỗi -vf (kiểu "Cổ điển" ra ĐÚNG chuỗi cũ của makeThumbnail) =====
const ffPath = f => String(f).replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '\u2019').replace(/%/g, '\\%');
const POS = {
  band: { box: 'drawbox=x=0:y=380:w=1280:h=340', x: '(w-text_w)/2', y: [430, 530, 650] },
  center: { box: 'drawbox=x=0:y=180:w=1280:h=360', x: '(w-text_w)/2', y: [220, 330, 460] },
  left: { box: 'drawbox=x=0:y=0:w=760:h=720', x: '60', y: [220, 330, 470] },
};
export function thumbVf(params, texts) {
  const p = params, L = POS[p.layout], font = ffPath(THUMB_FONTS[p.font].file());
  const vf = ['crop=iw-120:ih-80:0:0', 'scale=1280:720'];
  if (p.box_alpha > 0) vf.push(`${L.box}:color=${p.box_color}@${p.box_alpha}:t=fill`);
  [texts.line1, texts.line2, texts.sub_line].forEach((t, i) => {
    let d = `drawtext=fontfile='${font}':text='${esc(t)}':fontcolor=${p.colors[i]}:fontsize=${p.sizes[i]}:x=${L.x}:y=${L.y[i]}`;
    if (p.borders[i] > 0) d += `:borderw=${p.borders[i]}:bordercolor=${p.border_color}@${p.border_alpha[i]}`;
    if (p.shadow) d += ':shadowx=4:shadowy=4:shadowcolor=black@0.6';
    vf.push(d);
  });
  return vf.join(',');
}

// ===== Phụ đề → force_style (kiểu "Nâu kem" ra ĐÚNG chuỗi mặc định của compose) =====
const bgr = h => h.slice(5, 7) + h.slice(3, 5) + h.slice(1, 3);
export function subtitleForceStyle(p) {
  const aa = p.outline_alpha.toString(16).padStart(2, '0').toUpperCase();
  return `FontName=${p.font},FontSize=${p.size},PrimaryColour=&H00${bgr(p.primary).toUpperCase()},OutlineColour=&H${aa}${bgr(p.outline_color).toUpperCase()},`
    + `BorderStyle=${p.box ? 3 : 1},Outline=${p.outline},Shadow=0,Alignment=2,MarginV=${p.margin_v}` + (p.bold ? ',Bold=1' : '');
}

export const CLASSIC_THUMB = { font: 'times', layout: 'band', box_color: 'black', box_alpha: 0.55, colors: ['white', '#F5E5C0', '#EEDDBB'],
  sizes: [88, 88, 32], borders: [3, 3, 2], border_color: 'black', border_alpha: [0.7, 0.7, 0.6], shadow: 0 };

export const BUILTIN = [
  ['thumb-co-dien', 'thumb', 'Cổ điển (đang dùng)', CLASSIC_THUMB],
  ['thumb-giua-anh', 'thumb', 'Chữ lớn giữa ảnh', { font: 'arial', layout: 'center', box_color: 'black', box_alpha: 0, colors: ['white', '#FFE08A', 'white'],
    sizes: [96, 96, 36], borders: [6, 6, 3], border_color: 'black', border_alpha: [0.85, 0.85, 0.8], shadow: 0 }],
  ['thumb-khung-trai', 'thumb', 'Khung bên trái', { font: 'segoe', layout: 'left', box_color: 'black', box_alpha: 0.5, colors: ['white', '#F5E5C0', '#EEDDBB'],
    sizes: [80, 80, 32], borders: [2, 2, 1], border_color: 'black', border_alpha: [0.6, 0.6, 0.5], shadow: 0 }],
  ['thumb-thien', 'thumb', 'Thiền tối giản (thư pháp)', { font: 'dancing', layout: 'band', box_color: 'black', box_alpha: 0.35, colors: ['#F3ECDD', '#F3ECDD', '#E8DCC0'],
    sizes: [96, 96, 36], borders: [0, 0, 0], border_color: 'black', border_alpha: [0, 0, 0], shadow: 0 }],
  ['thumb-vang-noi', 'thumb', 'Vàng nổi (thư pháp đậm)', { font: 'pacifico', layout: 'center', box_color: 'black', box_alpha: 0, colors: ['#FFD54A', '#FFD54A', 'white'],
    sizes: [88, 88, 34], borders: [2, 2, 2], border_color: 'black', border_alpha: [0.8, 0.8, 0.8], shadow: 1 }],
  ['sub-nau-kem', 'subtitle', 'Nâu kem', { font: 'Arial', size: 16, primary: '#5A3A22', outline_color: '#F3ECDD', outline_alpha: 0, outline: 3, box: 0, margin_v: 60, bold: 0 }],
  ['sub-trang-vien-den', 'subtitle', 'Trắng viền đen', { font: 'Arial', size: 18, primary: '#FFFFFF', outline_color: '#000000', outline_alpha: 0, outline: 2, box: 0, margin_v: 40, bold: 1 }],
  ['sub-vang', 'subtitle', 'Vàng viền đen', { font: 'Arial', size: 18, primary: '#FFD54A', outline_color: '#000000', outline_alpha: 0, outline: 2, box: 0, margin_v: 40, bold: 1 }],
  ['sub-hop-nen', 'subtitle', 'Hộp nền mờ', { font: 'Segoe UI', size: 17, primary: '#FFFFFF', outline_color: '#000000', outline_alpha: 96, outline: 4, box: 1, margin_v: 40, bold: 0 }],
  ['sub-nho-goc', 'subtitle', 'Nhỏ, ít che hình', { font: 'Arial', size: 13, primary: '#FFFFFF', outline_color: '#000000', outline_alpha: 0, outline: 1, box: 0, margin_v: 25, bold: 0 }],
];
