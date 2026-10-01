// config.mjs — central config loader for the youtube-publish skill.
// Single source of truth for every per-machine path/setting so NOTHING is
// hardcoded in the scripts. Resolution order (first hit wins):
//   1. env var override (YTP_* — highest priority, good for CI)
//   2. config.json in the skill root (../../config.json relative to this file)
//   3. built-in Windows defaults
//
// Copy config.example.json -> config.json on each machine and edit paths.
// Secrets (OAuth) NEVER live here — see secretsFile (default: <agent>/secrets/yt-oauth.json).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/lib/config.mjs -> skill root is two levels up
const SKILL_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(SKILL_ROOT, 'config.json');

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

const fileCfg = fs.existsSync(CONFIG_PATH) ? readJsonSafe(CONFIG_PATH) : {};

// Built-in Windows defaults (target OS = Windows per design).
const defaults = {
  // where video files must be staged for the browser upload path
  uploadsDir: 'C:\\tmp\\aicoworker\\uploads',
  // ffmpeg / ffprobe binaries (prefer v9+ for complex filters)
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
  // CDP port of the built-in browser used by the fallback upload path
  cdpPort: 9333,
  // OAuth creds location (JSON: {client_id, client_secret, refresh_token})
  secretsFile: path.join(SKILL_ROOT, '..', '..', 'secrets', 'yt-oauth-anlacthienam.json'),
  // channel label (informational only; creds decide the actual channel)
  channelLabel: '',
  // default upload category + language
  categoryId: '27',
  defaultLanguage: 'vi',
};

function pick(key, envKey) {
  if (envKey && process.env[envKey]) return process.env[envKey];
  if (fileCfg[key] !== undefined && fileCfg[key] !== '') return fileCfg[key];
  return defaults[key];
}

export const config = {
  skillRoot: SKILL_ROOT,
  configPath: CONFIG_PATH,
  configExists: fs.existsSync(CONFIG_PATH),
  uploadsDir: pick('uploadsDir', 'YTP_UPLOADS_DIR'),
  ffmpeg: pick('ffmpeg', 'YTP_FFMPEG'),
  ffprobe: pick('ffprobe', 'YTP_FFPROBE'),
  cdpPort: Number(pick('cdpPort', 'YTP_CDP_PORT')),
  secretsFile: (() => {
    const v = pick('secretsFile', 'YTP_SECRETS_FILE');
    return path.isAbsolute(v) ? v : path.resolve(SKILL_ROOT, v);
  })(),
  channelLabel: pick('channelLabel', 'YTP_CHANNEL'),
  categoryId: String(pick('categoryId', 'YTP_CATEGORY')),
  defaultLanguage: pick('defaultLanguage', 'YTP_LANG'),
};

// Load OAuth creds from env first, then secretsFile. Returns null if none.
export function loadOAuth() {
  const e = process.env;
  if (e.YT_CLIENT_ID && e.YT_CLIENT_SECRET && e.YT_REFRESH_TOKEN) {
    return {
      client_id: e.YT_CLIENT_ID,
      client_secret: e.YT_CLIENT_SECRET,
      refresh_token: e.YT_REFRESH_TOKEN,
      source: 'env',
    };
  }
  try {
    const j = JSON.parse(fs.readFileSync(config.secretsFile, 'utf8'));
    // accept both snake_case and ENV-style (YT_CLIENT_ID) key names
    const client_id = j.client_id || j.YT_CLIENT_ID;
    const client_secret = j.client_secret || j.YT_CLIENT_SECRET;
    const refresh_token = j.refresh_token || j.YT_REFRESH_TOKEN;
    if (client_id && client_secret && refresh_token) {
      return { client_id, client_secret, refresh_token, source: config.secretsFile };
    }
  } catch { /* ignore */ }
  return null;
}

// Exchange a refresh token for a short-lived access token (pure fetch).
export async function getAccessToken(creds) {
  const body = new URLSearchParams({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    throw new Error('token refresh failed: ' + JSON.stringify(j));
  }
  return j.access_token;
}
