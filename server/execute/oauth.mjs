// oauth.mjs — Đăng nhập lại kênh hết hạn + thêm kênh mới NGAY TRÊN WEB (30/09, anh Vũ duyệt).
// Mã OAuth loại "Desktop" chỉ trả về http://127.0.0.1:8737 → trên điện thoại trang sẽ báo "không kết nối được",
// nhưng MÃ nằm sẵn trên thanh địa chỉ: anh copy URL đó dán vào app → app đổi mã lấy refresh_token.
// An toàn: KIỂM tài khoản vừa đăng nhập đúng kênh mới ghi; sao lưu file cũ trước khi ghi đè.
import fs from 'node:fs';
import { config, diskRoot } from '../config.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { get, all, run } from '../db/db.mjs';

const SECRETS_DIR = config.secretsDir.replace(/\\/g, '/');
const REDIRECT = 'http://127.0.0.1:8737';
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/youtube.force-ssl'].join(' ');
const pending = new Map(); // state → { mode, channelId, newId, at }

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
// Mọi kênh dùng CHUNG một OAuth client (đã kiểm 30/09) → lấy từ bất kỳ file đăng nhập nào.
function client() {
  const oc = config.oauthClient; if (oc?.client_id && oc?.client_secret) return { id: oc.client_id, secret: oc.client_secret };
  for (const c of all('SELECT secrets_file FROM channel WHERE secrets_file IS NOT NULL')) {
    try { const s = readJson(c.secrets_file); const id = s.client_id || s.YT_CLIENT_ID, sec = s.client_secret || s.YT_CLIENT_SECRET; if (id && sec) return { id, secret: sec }; } catch {}
  }
  throw new Error('Chưa có OAuth client: điền oauthClient {client_id, client_secret} trong config.json (xem CAI-DAT.md)');
}
async function accessToken(file) {
  const s = readJson(file);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
    client_id: s.client_id || s.YT_CLIENT_ID, client_secret: s.client_secret || s.YT_CLIENT_SECRET,
    refresh_token: s.refresh_token || s.YT_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(j.error_description || j.error || 'không đổi được mã');
  return j.access_token;
}
async function myChannel(token) {
  const j = await (await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', { headers: { authorization: 'Bearer ' + token } })).json();
  const c = j.items?.[0];
  if (!c) throw new Error('Tài khoản vừa đăng nhập không có kênh YouTube (hoặc chọn nhầm tài khoản)');
  const n = Number(c.statistics?.subscriberCount ?? 0);
  return { youtube_id: c.id, title: c.snippet.title, avatar: c.snippet.thumbnails?.default?.url ?? null,
    subs: n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n) };
}

export function startAuth({ channelId = null, newId = null }) {
  if (channelId && !get('SELECT 1 FROM channel WHERE id=?', channelId)) throw new Error('Không có kênh ' + channelId);
  if (!channelId) {
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(newId ?? '')) throw new Error('Mã kênh mới: chữ thường, số, gạch ngang (2–31 ký tự)');
    if (get('SELECT 1 FROM channel WHERE id=?', newId)) throw new Error('Mã kênh đã tồn tại: ' + newId);
  }
  const { id } = client();
  const state = crypto.randomBytes(12).toString('hex');
  for (const [k, v] of pending) if (Date.now() - v.at > 3600e3) pending.delete(k);
  pending.set(state, { mode: channelId ? 'relogin' : 'new', channelId, newId, at: Date.now() });
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: id, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPES,
    access_type: 'offline', prompt: 'consent select_account', state });
  return { url, state };
}

export async function finishAuth({ pasted }) {
  let u; try { u = new URL(String(pasted ?? '').trim()); } catch { throw new Error('Dán TOÀN BỘ địa chỉ trên thanh URL (bắt đầu bằng http://127.0.0.1:8737/?...)'); }
  const code = u.searchParams.get('code'), state = u.searchParams.get('state');
  if (u.searchParams.get('error')) throw new Error('Google báo: ' + u.searchParams.get('error'));
  if (!code || !state) throw new Error('Địa chỉ không có mã đăng nhập (code/state)');
  const p = pending.get(state);
  if (!p) throw new Error('Phiên đăng nhập đã hết hạn hoặc server vừa khởi động lại — bấm lại nút đăng nhập');
  pending.delete(state);
  const c = client();
  const tr = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
    code, client_id: c.id, client_secret: c.secret, redirect_uri: REDIRECT, grant_type: 'authorization_code' }) })).json();
  if (!tr.refresh_token) throw new Error('Google không trả refresh_token: ' + (tr.error_description || tr.error || JSON.stringify(tr).slice(0, 200)));
  const me = await myChannel(tr.access_token);
  const creds = { client_id: c.id, client_secret: c.secret, refresh_token: tr.refresh_token, channel: me.title, savedAt: new Date().toISOString() };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (p.mode === 'relogin') {
    const ch = get('SELECT * FROM channel WHERE id=?', p.channelId);
    if (ch.youtube_id && ch.youtube_id !== me.youtube_id)
      throw new Error(`Đăng nhập NHẦM kênh: vừa chọn "${me.title}", cần "${ch.name}". Không ghi gì — bấm lại và chọn đúng tài khoản.`);
    const file = ch.secrets_file || path.join(SECRETS_DIR, `yt-oauth-${ch.id}.json`).replace(/\\/g, '/');
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-${stamp}`);
    fs.writeFileSync(file, JSON.stringify(creds, null, 2), 'utf8');
    run("UPDATE channel SET secrets_file=?, youtube_id=?, token_status='valid', token_checked_at=datetime('now'), subscriber_count=?, avatar_url=COALESCE(?,avatar_url), updated_at=datetime('now') WHERE id=?",
      file, me.youtube_id, me.subs, me.avatar, ch.id);
    return { ok: true, mode: 'relogin', channel_id: ch.id, title: me.title, file };
  }
  const dup = get('SELECT id FROM channel WHERE youtube_id=?', me.youtube_id);
  if (dup) throw new Error(`Kênh "${me.title}" đã có trong app (mã ${dup.id}) — dùng nút Đăng nhập lại của kênh đó`);
  const file = path.join(SECRETS_DIR, `yt-oauth-${p.newId}.json`).replace(/\\/g, '/');
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-${stamp}`);
  fs.writeFileSync(file, JSON.stringify(creds, null, 2), 'utf8');
  run("INSERT INTO channel (id,name,youtube_id,secrets_file,token_status,token_checked_at,avatar_url,subscriber_count) VALUES (?,?,?,?,'valid',datetime('now'),?,?)",
    p.newId, me.title, me.youtube_id, file, me.avatar, me.subs);
  if (!get('SELECT 1 FROM text_pool WHERE id=?', p.newId)) run('INSERT INTO text_pool (id,channel_id,name) VALUES (?,?,?)', p.newId, p.newId, p.newId);
  return { ok: true, mode: 'new', channel_id: p.newId, title: me.title, file };
}

// Kiểm THẬT đăng nhập mọi kênh (đổi refresh_token → access_token), cập nhật nhãn.
export async function checkAllTokens() {
  const out = [];
  for (const ch of all('SELECT * FROM channel')) {
    let status = 'expired', err = null, title = null;
    try {
      if (!ch.secrets_file || !fs.existsSync(ch.secrets_file)) throw new Error('không có file đăng nhập');
      const me = await myChannel(await accessToken(ch.secrets_file));
      title = me.title;
      if (ch.youtube_id && me.youtube_id !== ch.youtube_id) throw new Error(`file đăng nhập thuộc kênh khác (${me.title})`);
      status = 'valid';
    } catch (e) { err = e.message; }
    run("UPDATE channel SET token_status=?, token_checked_at=datetime('now') WHERE id=?", status, ch.id);
    out.push({ id: ch.id, name: ch.name, status, error: err, title });
  }
  return out;
}
