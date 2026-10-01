#!/usr/bin/env node
/**
 * upload-api.mjs — Upload a video to YouTube via the Data API v3 using PURE fetch
 * (NO googleapis, NO npm — bundled npm is broken on some hosts). Node 18+ global
 * fetch only. Resumable upload so large files survive.
 *
 * Creds: env YT_CLIENT_ID/SECRET/REFRESH_TOKEN OR secrets file (see lib/config.mjs).
 * Scope needed: https://www.googleapis.com/auth/youtube.upload (+ youtube for thumbnail).
 *
 * Usage:
 *   node upload-api.mjs --file "<path.mp4>" --title "..." [--desc-file desc.txt]
 *        [--tags "a,b,c"] [--category 27] [--lang vi] [--privacy private|unlisted|public]
 *        [--publishAt 2026-01-01T09:00:00Z] [--madeForKids false] [--thumb thumb.jpg]
 *        [--playlist PLxxxx]
 *
 * NOTE (portability): an UNVERIFIED OAuth project forces uploads to PRIVATE and
 * cannot flip them public via API; quota caps videos.insert at ~6/day (1600 units).
 * On youtubeSignupRequired/forbidden/unverified/quota errors the orchestrator falls
 * back to the browser path. This script exits 2 with { fallback:'browser' } then.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadOAuth, getAccessToken, config } from './lib/config.mjs';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function out(o) { console.log(JSON.stringify(o)); }
function fail(msg, code = 1, extra = {}) { out({ ok: false, error: msg, ...extra }); process.exit(code); }

const file = arg('file');
const title = arg('title');
if (!file || !title) fail('--file and --title are required');
if (!fs.existsSync(file)) fail('file not found: ' + file);

const creds = loadOAuth();
if (!creds) fail('missing OAuth creds (env YT_CLIENT_ID/SECRET/REFRESH_TOKEN or secrets file). Run setup-oauth.', 1, { blocker: 'missing-oauth-creds' });

const descFile = arg('desc-file');
const description = descFile && fs.existsSync(descFile) ? fs.readFileSync(descFile, 'utf8') : (arg('desc') || '');
const tags = (arg('tags') || '').split(',').map(s => s.trim()).filter(Boolean);
const categoryId = arg('category', config.categoryId);
const lang = arg('lang', config.defaultLanguage);
let privacy = arg('privacy', 'private');
const publishAt = arg('publishAt');
const madeForKids = String(arg('madeForKids', 'false')) === 'true';
const thumb = arg('thumb');
const playlist = arg('playlist');
if (publishAt) privacy = 'private'; // scheduled must start private

const FALLBACK_RE = /youtubeSignupRequired|forbidden|unverified|quotaExceeded|dailyLimitExceeded/i;

async function main() {
  const token = await getAccessToken(creds);
  const meta = {
    snippet: { title, description, tags, categoryId, defaultLanguage: lang, defaultAudioLanguage: lang },
    status: {
      privacyStatus: privacy,
      selfDeclaredMadeForKids: madeForKids,
      ...(publishAt ? { publishAt } : {}),
    },
  };
  const size = fs.statSync(file).size;

  // 1) start resumable session
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size),
      'X-Upload-Content-Type': 'video/*',
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) {
    const t = await init.text();
    const code = FALLBACK_RE.test(t) ? 2 : 1;
    fail('init failed: ' + t, code, code === 2 ? { fallback: 'browser' } : {});
  }
  const uploadUrl = init.headers.get('location');
  if (!uploadUrl) fail('no resumable upload URL returned');

  // 2) upload bytes as ONE CONTINUOUS STREAM (nhanh hơn chia khối nhiều lần:
  //    giữ 1 kết nối TCP duy nhất nên không bị slow-start lặp lại).
  //    Vẫn RESUMABLE ở cấp phiên: rớt mạng -> hỏi Google đã nhận tới đâu -> gửi tiếp phần còn lại.
  //    Dùng createReadStream nên KHÔNG nạp cả file vào RAM.
  let video = null;
  let offset = 0;          // byte kế tiếp cần gửi
  let attempt = 0;
  const MAX_ATTEMPTS = 5;
  const t0 = Date.now();

  while (attempt < MAX_ATTEMPTS && !video) {
    attempt++;
    try {
      const remaining = size - offset;
      const stream = fs.createReadStream(file, { start: offset, highWaterMark: 4 * 1024 * 1024 });

      // QUAN TRỌNG: KHÔNG gắn listener 'data' vào stream — sẽ nuốt mất dữ liệu
      // trước khi fetch kịp gửi. Đọc bytesRead định kỳ là an toàn tuyệt đối.
      const tStream = Date.now();
      const progress = setInterval(() => {
        const sent = stream.bytesRead || 0;
        const doneMB = (offset + sent) / 1048576;
        const rate = (sent / 1048576) / Math.max(1, (Date.now() - tStream) / 1000);
        console.error(`[Upload] ${doneMB.toFixed(0)}MB / ${(size / 1048576).toFixed(0)}MB ` +
          `(${(((offset + sent) / size) * 100).toFixed(1)}%) ~${rate.toFixed(1)} MB/s`);
      }, 15000);
      progress.unref?.();

      let res;
      try {
        res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/*',
          'Content-Length': String(remaining),
          ...(offset > 0 ? { 'Content-Range': `bytes ${offset}-${size - 1}/${size}` } : {}),
        },
          body: stream,
          duplex: 'half',
        });
      } finally {
        clearInterval(progress);
      }

      if (res.ok || res.status === 200 || res.status === 201) {
        video = JSON.parse(await res.text());
        const secs = (Date.now() - t0) / 1000;
        console.error(`[Upload] 100% completed in ${secs.toFixed(0)}s ` +
          `(~${((size / 1048576) / secs).toFixed(1)} MB/s). Video ID: ${video.id}`);
        break;
      }

      if (res.status === 308) {
        // Google nhận được một phần -> lấy mốc byte rồi gửi tiếp
        const range = res.headers.get('range');
        const m = range && range.match(/bytes=0-(\d+)/);
        offset = m ? parseInt(m[1], 10) + 1 : offset;
        console.error(`[Upload] Nối tiếp từ byte ${offset} (lần ${attempt}/${MAX_ATTEMPTS})`);
        continue;
      }

      const vt = await res.text();
      console.error(`[Upload] HTTP error status=${res.status} body=${vt}`);
      const code = FALLBACK_RE.test(vt) ? 2 : 1;
      fail('upload failed: ' + vt, code, code === 2 ? { fallback: 'browser' } : {});
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) fail(`upload failed after ${MAX_ATTEMPTS} attempts: ${err.message}`);
      console.error(`[Upload] Lỗi mạng (lần ${attempt}/${MAX_ATTEMPTS}): ${err.message} — đang hỏi lại mốc đã nhận...`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
      // Hỏi Google đã nhận tới byte nào để gửi tiếp, không phải làm lại từ đầu
      try {
        const probe = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Length': '0', 'Content-Range': `bytes */${size}` },
        });
        if (probe.status === 308) {
          const range = probe.headers.get('range');
          const m = range && range.match(/bytes=0-(\d+)/);
          offset = m ? parseInt(m[1], 10) + 1 : 0;
          console.error(`[Upload] Google đã nhận tới byte ${offset}, gửi tiếp từ đó.`);
        } else if (probe.ok) {
          video = JSON.parse(await probe.text());
        }
      } catch (e2) { /* thử lại vòng sau */ }
    }
  }

  if (!video || !video.id) fail('upload completed but no video object returned');
  const videoId = video.id;

  // 3) thumbnail (optional; needs youtube scope + verified channel + <2MB)
  let thumbOk = null;
  if (thumb && fs.existsSync(thumb)) {
    const tb = fs.readFileSync(thumb);
    const ct = thumb.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    const tr = await fetch('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=' + videoId, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': ct }, body: tb,
    });
    thumbOk = tr.ok ? true : ('failed: ' + (await tr.text()).slice(0, 200));
  }

  // 4) playlist (optional)
  let playlistOk = null;
  if (playlist) {
    const pr = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ snippet: { playlistId: playlist, resourceId: { kind: 'youtube#video', videoId } } }),
    });
    playlistOk = pr.ok ? true : ('failed: ' + (await pr.text()).slice(0, 200));
  }

  out({
    ok: true, path: 'api', videoId,
    url: 'https://youtu.be/' + videoId,
    privacy: video.status?.privacyStatus || privacy,
    thumbnail: thumbOk, playlist: playlistOk,
    note: privacy === 'private' ? 'Unverified API projects lock uploads to PRIVATE — flip to public in Studio after review.' : undefined,
  });
}

main().catch(e => fail(String(e && e.message || e)));
