// notify.mjs — Giờ Việt Nam, ghi log ra file text, dọn log > 30 ngày, báo Telegram.
// Anh Vũ chốt 30/09: log tiếng Việt có dấu, giờ Việt Nam (toàn app), giữ 30 ngày;
// Telegram dùng bot hiện tại (MainVPS1) — mã bot đọc lúc chạy từ openclaw.json, KHÔNG sao chép ra file khác.
import fs from 'node:fs';
import { config, diskRoot } from '../config.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LOG_DIR = path.resolve(HERE, '..', '..', 'logs');
const TZ = 'Asia/Ho_Chi_Minh';
const TG = config.telegram || {};
const CHAT_ID = TG.chatId;
const KEEP_DAYS = 30;
export const TELEGRAM_ENABLED = TG.enabled === true; // config.json → telegram.enabled

// ---- giờ Việt Nam ----
function parts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const o = Object.fromEntries(f.formatToParts(d).map(p => [p.type, p.value]));
  if (o.hour === '24') o.hour = '00';
  return o;
}
export const vnDate = (d) => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };        // YYYY-MM-DD
export const vnTime = (d) => { const p = parts(d); return `${p.hour}:${p.minute}`; };               // HH:MM
export const vnStamp = (d) => { const p = parts(d); return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`; };
export const vnFileStamp = (d) => { const p = parts(d); return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}`; };
// Chuỗi thời gian SQLite (UTC 'YYYY-MM-DD HH:MM:SS') → giờ VN hiển thị
export const vnFromSql = s => s ? vnStamp(new Date(s.replace(' ', 'T') + 'Z')) : '';

// ---- log file ----
export function logPath(name) { fs.mkdirSync(LOG_DIR, { recursive: true }); return path.join(LOG_DIR, name); }
export function appendLog(file, msg) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = String(msg).split(/\r?\n/).map(l => `[${vnStamp()}] ${l}`).join('\n');
  fs.appendFileSync(file, lines + '\n', 'utf8');
}
export function pruneLogs(days = KEEP_DAYS) {
  if (!fs.existsSync(LOG_DIR)) return 0;
  const cut = Date.now() - days * 86400e3; let n = 0;
  for (const f of fs.readdirSync(LOG_DIR)) {
    const p = path.join(LOG_DIR, f);
    try { const st = fs.statSync(p); if (st.isFile() && st.mtimeMs < cut) { fs.unlinkSync(p); n++; } } catch {}
  }
  return n;
}

// ---- Telegram ----
function botToken() {
  if (TG.botToken) return TG.botToken;
  if (TG.openclawConfig) {   // máy có AICoworker: đọc mã bot tại chỗ, không chép ra file khác
    const c = JSON.parse(fs.readFileSync(TG.openclawConfig, 'utf8').replace(/^\uFEFF/, ''));
    const t = c.channels?.telegram?.accounts?.[TG.account]?.botToken;
    if (t) return t;
  }
  throw new Error('không thấy mã bot Telegram (config.json → telegram)');
}
export async function sendTelegram(text) {
  // Anh Vũ 30/09 05:43: TẠM THỜI CHƯA gửi Telegram. Bật lại: đổi TELEGRAM_ENABLED = true.
  if (!TELEGRAM_ENABLED || process.env.YCF_NO_TELEGRAM === '1') return { skipped: true };
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken()}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: String(text).slice(0, 4000), disable_web_page_preview: true }),
    });
    const j = await r.json();
    return { ok: !!j.ok, error: j.ok ? null : j.description };
  } catch (e) { return { ok: false, error: e.message }; } // báo Telegram lỗi KHÔNG được làm hỏng chuỗi
}
