// config.mjs — MỌI đường dẫn/thiết lập phụ thuộc máy nằm ở đây (30/09: đóng gói chạy được trên máy khác).
// Đọc <app>/config.json (KHÔNG đưa lên git). Thiếu khoá nào thì dùng mặc định tương đối theo thư mục app.
// Mẫu: config.example.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.YCF_CONFIG || path.join(APP_ROOT, 'config.json');
let raw = {};
try { if (fs.existsSync(FILE)) raw = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '')); }
catch (e) { console.error('config.json lỗi cú pháp — dùng mặc định:', e.message); }
const abs = p => (p ? path.resolve(APP_ROOT, p) : p);

export const config = {
  port: Number(process.env.YCF_PORT || raw.port || 18990),
  // file đăng nhập YouTube của các kênh (refresh_token) — tuyệt đối không đưa lên git
  secretsDir: abs(raw.secretsDir || 'secrets'),
  // thư mục dựng tạm (cần trống ≥ 12 GB cho video 4 giờ); ổ của thư mục này được canh đĩa
  workDir: abs(raw.workDir || 'work'),
  // ffmpeg/ffprobe: đường dẫn đầy đủ, hoặc để 'ffmpeg' nếu đã có trong PATH
  ffmpeg: raw.ffmpeg || null,
  // script upload YouTube (đã chép vào app)
  uploadScriptsDir: abs(raw.uploadScriptsDir || 'vendor/youtube-publish'),
  // số tập tự tăng (tiêu đề "Số N") của playlist có đánh số tập
  episodeFile: abs(raw.episodeFile || 'data/episode.json'),
  // font chữ thumbnail (Windows)
  thumbnailFont: raw.thumbnailFont || 'C:/Windows/Fonts/timesbd.ttf',
  // OAuth client "Desktop app" của Google Cloud — cần để đăng nhập kênh trên máy mới
  oauthClient: raw.oauthClient || null,          // { client_id, client_secret }
  // Telegram (tuỳ chọn): { enabled, botToken | openclawConfig+account, chatId }
  telegram: raw.telegram || { enabled: false },
};
export const diskRoot = () => path.parse(config.workDir).root;
