// #2 Upload a caption track (.srt) to an EXISTING YouTube video via Data API v3.
// Used because the Studio "add subtitles" dialog is broken on this host (the
// "Có thông tin thời gian" timing radio never appears → cues=0).
//
// PURE fetch — NO googleapis, NO npm (bundled npm is broken on this host). Uses
// Node's global fetch only. Needs OAuth creds in env (one-time setup, see
// references/api-fallback.md §Setup): scope https://www.googleapis.com/auth/youtube.force-ssl
//   YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN
//
// Usage:
//   node upload-caption-api.mjs --video <id> --srt <path.srt> [--lang vi] [--name "Tiếng Việt"] [--draft false]
//
// Why 6h delay: YouTube must finish processing the video before a caption track
// attaches cleanly; schedule this ~6h after a successful upload (see SKILL.md
// "Phụ đề CC tự động"). Quota: captions.insert ~400 units (well under 10k/day).

import fs from 'node:fs';
import { loadOAuth, getAccessToken } from './lib/config.mjs';

const argv = process.argv.slice(2);
const get = k => { const i = argv.indexOf('--' + k); return i > -1 ? argv[i + 1] : undefined; };
const videoId = get('video'); const srt = get('srt');
const lang = get('lang') || 'vi'; const name = get('name') || 'Tiếng Việt';
const isDraft = (get('draft') || 'false') === 'true';
if (!videoId || !srt) { console.error('usage: --video <id> --srt <path> [--lang vi] [--name ..] [--draft false]'); process.exit(64); }
if (!fs.existsSync(srt)) { console.error('srt not found: ' + srt); process.exit(66); }

const creds = loadOAuth();
if (!creds) {
  console.error(JSON.stringify({ ok: false, blocker: 'missing-oauth-creds', need: ['YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REFRESH_TOKEN'], hint: 'See references/setup-oauth.md. Scope: youtube.force-ssl. Put creds in env or secrets/yt-oauth.json. (No npm/googleapis needed — pure fetch.)' }));
  process.exit(3);
}

// 1) refresh_token -> access_token (shared loader)
async function accessToken() { return getAccessToken(creds); }

// 2) captions.insert as multipart/related (metadata + srt bytes)
try {
  const token = await accessToken();
  const boundary = '----ytcap' + Date.now();
  const meta = JSON.stringify({ snippet: { videoId, language: lang, name, isDraft } });
  const srtBuf = fs.readFileSync(srt);
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`, 'utf8');
  const post = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const payload = Buffer.concat([pre, srtBuf, post]);

  const url = 'https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart&sync=false';
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': `multipart/related; boundary=${boundary}` }, body: payload });
  const j = await r.json();
  if (!r.ok) throw new Error('captions.insert ' + r.status + ': ' + JSON.stringify(j));
  console.log(JSON.stringify({ ok: true, captionId: j.id, videoId, lang, name }));
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: (e && e.message) || String(e), videoId }));
  process.exit(1);
}
