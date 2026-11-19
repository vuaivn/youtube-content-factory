// Tự cập nhật 1 nút (18/11/2026): so VERSION local với GitHub, chạy cap-nhat.bat tách rời rồi thoát.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = 'https://raw.githubusercontent.com/vuaivn/youtube-content-factory/main/';
const CACHE_MS = 6 * 3600 * 1000;
let cache = null; // { at, latest, changelog, error }

const localVersion = () => { try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); } catch { return '0.0.0'; } };
function headHash() {
  const r = spawnSync('git', ['-c', 'safe.directory=*', '-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
}
export function cmpSemver(a, b) {
  const p = v => String(v).replace(/^v/, '').split(/[.-]/).slice(0, 3).map(x => parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
  return 0;
}
async function fetchText(name) {
  const r = await fetch(RAW + name + '?t=' + Date.now(), { signal: AbortSignal.timeout(10_000), headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.text();
}
async function refresh(force) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache;
  try {
    const [v, cl] = await Promise.all([fetchText('VERSION'), fetchText('CHANGELOG.md').catch(() => '')]);
    cache = { at: Date.now(), latest: v.trim(), changelog: cl, error: null };
  } catch (e) {
    cache = { at: Date.now() - CACHE_MS + 10 * 60 * 1000, latest: cache?.latest ?? null, changelog: cache?.changelog ?? '', error: e.message }; // lỗi mạng: thử lại sau 10 phút
  }
  return cache;
}

export function registerUpdateRoutes(route, logDir) {
  refresh(true); // kiểm tra ngay khi khởi động
  route('GET', '/api/update/check', async (p, body, q) => {
    const c = await refresh(q?.get('force') === '1');
    const current = localVersion();
    return { current, head: headHash(), latest: c.latest, hasUpdate: !!c.latest && cmpSemver(c.latest, current) > 0,
      changelog: c.changelog, checkedAt: new Date(c.at).toISOString(), error: c.error };
  });
  route('POST', '/api/update/run', () => {
    const bat = path.join(ROOT, 'cap-nhat.bat');
    if (!fs.existsSync(bat)) throw new Error('Không thấy cap-nhat.bat');
    const child = spawn('cmd.exe', ['/c', bat, '--auto'], { cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore' });
    child.unref();
    setTimeout(() => process.exit(0), 1500);
    return { ok: true };
  });
  route('GET', '/api/update/log', () => {
    const f = path.join(logDir ?? path.join(ROOT, 'logs'), 'update.log');
    if (!fs.existsSync(f)) return { log: '' };
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    return { log: lines.slice(-80).join('\n') };
  });
}
