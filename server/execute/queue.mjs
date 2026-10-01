// queue.mjs — BỘ GIÁM SÁT CHUỖI (chạy trong server). Anh Vũ chốt 30/09:
//  • Mỗi video một TIẾN TRÌNH RIÊNG (run-job.mjs), nhưng tại mọi thời điểm CHỈ MỘT kênh chạy.
//  • Kênh trước xong (thành công hay lỗi) + dọn xong file tạm → chạy NGAY kênh kế, không thời gian chết.
//  • Treo: 10 phút liền không có tiến độ (CPU cây tiến trình, dung lượng/giờ sửa file) → dừng, ghi log, dọn, sang kênh kế.
//  • Đến giờ hẹn mà chuỗi khác đang chạy → chuỗi mới XẾP HÀNG, không chạy chồng.
//  • Hàng đợi + lịch lưu DB → server khởi động lại vẫn chạy tiếp. Giờ hẹn = giờ Việt Nam.
import fs from 'node:fs';
import { config, diskRoot } from '../config.mjs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { get, all, run, openDb } from '../db/db.mjs';
import { migrateQueue } from '../migrate/m3-queue.mjs';
import { appendLog, logPath, pruneLogs, sendTelegram, vnDate, vnTime, vnFileStamp, vnFromSql } from './notify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN_JOB = process.env.YCF_RUN_JOB || path.join(HERE, 'run-job.mjs'); // test giả lập thay bằng tiến trình giả
const OUT_ROOT = config.workDir;
export const STALL_MS = Number(process.env.YCF_STALL_MS || 10 * 60 * 1000);
const TICK_MS = 15000;
let timer = null, ticking = false, lastPrune = 0;

// ---------- tạo chuỗi ----------
export function createChain({ name, playlistIds, source = 'manual', scheduleId = null }) {
  if (!Array.isArray(playlistIds) || !playlistIds.length) throw new Error('Chưa chọn playlist nào');
  for (const id of playlistIds) {
    const pl = get('SELECT archived FROM playlist WHERE id=?', id);
    if (!pl) throw new Error('Không có playlist ' + id);
    if (pl.archived) throw new Error('Playlist đã lưu trữ: ' + id);
  }
  const stamp = vnFileStamp();
  const chainLog = logPath(`chuoi-${stamp}.log`);
  const cid = run('INSERT INTO chain (name,source,schedule_id,status,log_file) VALUES (?,?,?,?,?)',
    name || `Chuỗi ${stamp}`, source, scheduleId, 'queued', chainLog).lastInsertRowid;
  playlistIds.forEach((pid, i) => run('INSERT INTO chain_item (chain_id,position,playlist_id,log_file) VALUES (?,?,?,?)',
    cid, i + 1, pid, logPath(`job-chuoi${cid}-${i + 1}-${pid}.log`)));
  appendLog(chainLog, `Tạo chuỗi #${cid} (${source === 'schedule' ? 'theo lịch hẹn' : 'bấm tay'}): ${playlistIds.join(' → ')}`);
  setTimeout(tick, 200);
  return getChain(cid);
}
export function getChain(id) {
  const c = get('SELECT * FROM chain WHERE id=?', id);
  if (c) c.items = all('SELECT * FROM chain_item WHERE chain_id=? ORDER BY position', id);
  return c;
}
export function listChains(limit = 20) {
  return all('SELECT * FROM chain ORDER BY id DESC LIMIT ?', limit).map(c => ({ ...c, items: all('SELECT * FROM chain_item WHERE chain_id=? ORDER BY position', c.id) }));
}

// ---------- điều khiển ----------
export function pauseChain(id) {
  const c = get('SELECT * FROM chain WHERE id=?', id);
  if (!c || !['running', 'queued'].includes(c.status)) throw new Error('Chuỗi không ở trạng thái chạy/chờ');
  run("UPDATE chain SET status='paused' WHERE id=?", id);
  appendLog(c.log_file, 'Tạm dừng — kênh đang chạy (nếu có) vẫn làm cho xong, sau đó KHÔNG chạy kênh kế.');
  return getChain(id);
}
export function resumeChain(id) {
  const c = get('SELECT * FROM chain WHERE id=?', id);
  if (!c || c.status !== 'paused') throw new Error('Chuỗi không ở trạng thái tạm dừng');
  run("UPDATE chain SET status=? WHERE id=?", c.started_at ? 'running' : 'queued', id);
  appendLog(c.log_file, 'Chạy tiếp.');
  setTimeout(tick, 200);
  return getChain(id);
}
export function cancelChain(id) {
  const c = get('SELECT * FROM chain WHERE id=?', id);
  if (!c || ['done', 'cancelled'].includes(c.status)) throw new Error('Chuỗi đã kết thúc');
  const cur = get("SELECT * FROM chain_item WHERE chain_id=? AND status='running'", id);
  if (cur) finishItem(cur, 'cancelled', 'Anh huỷ chuỗi', { kill: true });
  run("UPDATE chain_item SET status='cancelled', finished_at=datetime('now') WHERE chain_id=? AND status='pending'", id);
  run("UPDATE chain SET status='cancelled', finished_at=datetime('now') WHERE id=?", id);
  appendLog(c.log_file, 'ĐÃ HUỶ chuỗi.');
  setTimeout(tick, 200);
  return getChain(id);
}

// ---------- tiến trình ----------
function alive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } }
function killTree(pid) { if (pid) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }); }
// Tổng CPU (giây) của cả cây tiến trình: run-job → compose2 → ffmpeg / upload.
function treeCpu(rootPid) {
  const r = spawnSync('powershell', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId),$($_.KernelModeTime + $_.UserModeTime)" }'],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const rows = (r.stdout || '').trim().split(/\r?\n/).map(l => l.split(',').map(Number));
  const kids = new Map(); const cpu = new Map();
  for (const [p, pp, t] of rows) { cpu.set(p, t); if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(p); }
  let sum = 0; const st = [rootPid], seen = new Set();
  while (st.length) { const p = st.pop(); if (seen.has(p)) continue; seen.add(p); sum += cpu.get(p) ?? 0; for (const k of kids.get(p) ?? []) st.push(k); }
  return Math.round(sum / 1e7); // đơn vị 100ns → giây
}
function dirSig(dir) {
  let bytes = 0, newest = 0;
  const walk = d => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else try { const s = fs.statSync(p); bytes += s.size; newest = Math.max(newest, s.mtimeMs); } catch {} } };
  if (dir) walk(dir);
  return { bytes, newest };
}
const outDirOf = item => item.job_id ? path.join(OUT_ROOT, `${item.playlist_id}-job${item.job_id}`) : null;

function finishItem(item, status, error, { kill = false } = {}) {
  if (kill) killTree(item.pid);
  const od = outDirOf(item);
  if (od && fs.existsSync(od)) { try { fs.rmSync(od, { recursive: true, force: true }); appendLog(item.log_file, 'Dọn file tạm: xoá ' + od); } catch (e) { appendLog(item.log_file, '⚠ Dọn lỗi: ' + e.message); } }
  if (item.job_id) run("UPDATE job SET status='failed', error=?, finished_at=datetime('now') WHERE id=? AND status NOT IN ('done','failed','cancelled')", error, item.job_id);
  run("UPDATE chain_item SET status=?, error=COALESCE(error, ?), pid=NULL, finished_at=datetime('now') WHERE id=?", status, error, item.id);
  appendLog(item.log_file, `${status === 'cancelled' ? '⏹ HUỶ' : '❌ LỖI'}: ${error}`);
}

function startItem(chain, item) {
  const fd = fs.openSync(item.log_file, 'a');
  const child = spawn(process.execPath, [RUN_JOB, '--item', String(item.id)], {
    detached: true, stdio: ['ignore', fd, fd], windowsHide: true, env: { ...process.env },
  });
  child.unref(); fs.closeSync(fd);
  run("UPDATE chain_item SET status='running', stage='Khởi động', pid=?, started_at=datetime('now'), last_progress_at=datetime('now'), progress_sig=NULL WHERE id=?", child.pid, item.id);
  const pl = get('SELECT name FROM playlist WHERE id=?', item.playlist_id);
  appendLog(chain.log_file, `▶ Kênh ${item.position}: ${pl?.name ?? item.playlist_id} (PID ${child.pid})`);
}

async function notifyItem(chain, item) {
  const pl = get('SELECT p.name, c.name AS ch FROM playlist p JOIN channel c ON c.id=p.channel_id WHERE p.id=?', item.playlist_id);
  const total = get('SELECT COUNT(*) n FROM chain_item WHERE chain_id=?', chain.id).n;
  const head = `[YouTube Content Factory] Chuỗi #${chain.id} · kênh ${item.position}/${total}\n${pl?.ch} · ${pl?.name}`;
  const body = item.status === 'done'
    ? `✅ Xong${item.youtube_video_id ? ` · https://youtu.be/${item.youtube_video_id}` : ''}`
    : item.status === 'cancelled' ? '⏹ Đã huỷ' : `❌ Lỗi: ${String(item.error ?? '').slice(0, 300)}`;
  const tg = await sendTelegram(`${head}\n${body}\nLúc ${vnFromSql(item.finished_at)} (giờ VN)`);
  run('UPDATE chain_item SET notified=1 WHERE id=?', item.id);
  appendLog(chain.log_file, `Báo Telegram kênh ${item.position}: ${tg.skipped ? 'tắt (chạy thử)' : tg.ok ? 'đã gửi' : 'LỖI ' + tg.error}`);
  appendLog(chain.log_file, `Kênh ${item.position}: ${item.status}${item.youtube_video_id ? ' · https://youtu.be/' + item.youtube_video_id : ''}${item.error ? ' · ' + item.error : ''}`);
}

function checkSchedules() {
  const today = vnDate(), now = vnTime();
  for (const s of all('SELECT * FROM schedule WHERE enabled=1')) {
    if (s.last_run_date_vn === today || now < s.time_vn) continue;
    run('UPDATE schedule SET last_run_date_vn=? WHERE id=?', today, s.id);
    // playlist đã lưu trữ → bỏ khỏi lượt chạy theo lịch (lịch vẫn giữ, khôi phục là chạy lại)
    const ids = JSON.parse(s.playlist_ids).filter(id => get('SELECT 1 FROM playlist WHERE id=? AND archived=0', id));
    if (!ids.length) continue;
    try { createChain({ name: `${s.name} (lịch ${s.time_vn} ngày ${today})`, playlistIds: ids, source: 'schedule', scheduleId: s.id }); }
    catch (e) { sendTelegram(`[YouTube Content Factory] Lịch "${s.name}" không tạo được chuỗi: ${e.message}`); }
  }
}

export async function tick() {
  if (ticking) return; ticking = true;
  try {
    if (Date.now() - lastPrune > 6 * 3600e3) { pruneLogs(30); lastPrune = Date.now(); }
    checkSchedules();

    // báo các kênh vừa kết thúc
    for (const it of all("SELECT * FROM chain_item WHERE status IN ('done','failed','cancelled') AND notified=0 AND started_at IS NOT NULL")) {
      await notifyItem(get('SELECT * FROM chain WHERE id=?', it.chain_id), it);
    }

    // chuỗi đang giữ quyền chạy: running hoặc paused (paused vẫn có thể còn kênh đang chạy nốt)
    let chain = get("SELECT * FROM chain WHERE status IN ('running','paused') ORDER BY id LIMIT 1");
    if (!chain) {
      chain = get("SELECT * FROM chain WHERE status='queued' ORDER BY id LIMIT 1");
      if (!chain) return;
      run("UPDATE chain SET status='running', started_at=datetime('now') WHERE id=?", chain.id);
      chain = get('SELECT * FROM chain WHERE id=?', chain.id);
      appendLog(chain.log_file, `Bắt đầu chuỗi #${chain.id}`);
    }

    const cur = get("SELECT * FROM chain_item WHERE chain_id=? AND status='running'", chain.id);
    if (cur) {
      if (!alive(cur.pid)) {
        // tiến trình chết mà chưa tự ghi kết quả (server khởi động lại, máy tắt, bị giết…)
        const again = get('SELECT status FROM chain_item WHERE id=?', cur.id);
        if (again.status === 'running') finishItem(cur, 'failed', 'Tiến trình dựng đã dừng bất thường');
        return setTimeout(tick, 500);
      }
      // canh treo: có BẤT KỲ dấu hiệu nào đổi là còn sống
      const d = dirSig(outDirOf(cur)); const lg = dirSig(null);
      let logM = 0; try { logM = fs.statSync(cur.log_file).mtimeMs; } catch {}
      const sig = `${treeCpu(cur.pid)}|${d.bytes}|${Math.round(d.newest)}|${Math.round(logM)}|${cur.stage}`;
      if (sig !== cur.progress_sig) run("UPDATE chain_item SET progress_sig=?, last_progress_at=datetime('now') WHERE id=?", sig, cur.id);
      else {
        const idle = Date.now() - new Date(cur.last_progress_at.replace(' ', 'T') + 'Z').getTime();
        if (idle >= STALL_MS) {
          const dur = idle >= 60000 ? Math.round(idle / 60000) + ' phút' : Math.round(idle / 1000) + ' giây';
          appendLog(chain.log_file, `Kênh ${cur.position} treo ${dur} (bước "${cur.stage}") → dừng, dọn, sang kênh kế`);
          finishItem(cur, 'failed', `Treo ${dur} ở bước "${cur.stage}" — không có tiến độ`, { kill: true });
          return setTimeout(tick, 500);
        }
      }
      return;
    }

    if (chain.status === 'paused') return;
    const next = get("SELECT * FROM chain_item WHERE chain_id=? AND status='pending' ORDER BY position LIMIT 1", chain.id);
    if (next) { startItem(chain, next); return; }

    // hết kênh → kết thúc chuỗi + tổng kết
    const items = all('SELECT ci.*, p.name AS pname FROM chain_item ci JOIN playlist p ON p.id=ci.playlist_id WHERE chain_id=? ORDER BY position', chain.id);
    run("UPDATE chain SET status='done', finished_at=datetime('now') WHERE id=?", chain.id);
    const ok = items.filter(i => i.status === 'done').length;
    const lines = items.map(i => `${i.position}. ${i.pname}: ${i.status === 'done' ? '✅ ' + (i.youtube_video_id ? 'https://youtu.be/' + i.youtube_video_id : 'xong') : i.status === 'cancelled' ? '⏹ huỷ' : '❌ ' + String(i.error ?? '').slice(0, 120)}`);
    appendLog(chain.log_file, `===== TỔNG KẾT chuỗi #${chain.id}: ${ok}/${items.length} kênh thành công =====\n${lines.join('\n')}`);
    const tg = await sendTelegram(`[YouTube Content Factory] Xong chuỗi #${chain.id}: ${ok}/${items.length} kênh thành công\n${lines.join('\n')}`);
    appendLog(chain.log_file, `Báo Telegram tổng kết: ${tg.skipped ? 'tắt (chạy thử)' : tg.ok ? 'đã gửi' : 'LỖI ' + tg.error}`);
    setTimeout(tick, 500);
  } catch (e) {
    console.error('[queue] tick lỗi:', e);
  } finally { ticking = false; }
}

// Server + tiến trình dựng cùng ghi một DB → chờ khoá tối đa 15s thay vì lỗi SQLITE_BUSY ngay.
export function dbConcurrency() { const db = openDb(); db.exec('PRAGMA journal_mode=WAL'); db.exec('PRAGMA busy_timeout=15000'); }
export function startSupervisor() {
  dbConcurrency();
  migrateQueue();
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  setTimeout(tick, 2000);
}

// ---------- lịch ----------
export function saveSchedule(body, id = null) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time_vn ?? '')) throw new Error('Giờ hẹn phải dạng HH:MM (giờ Việt Nam)');
  if (!Array.isArray(body.playlist_ids) || !body.playlist_ids.length) throw new Error('Chưa chọn playlist');
  for (const p of body.playlist_ids) if (!get('SELECT 1 FROM playlist WHERE id=?', p)) throw new Error('Không có playlist ' + p);
  const name = (body.name || `Lịch ${body.time_vn}`).trim();
  // Tạo mới lúc đã quá giờ hôm nay thì KHÔNG chạy bù hôm nay (tránh chạy ngay khi vừa bấm lưu) — chạy từ ngày mai.
  const lastRun = !id && vnTime() >= body.time_vn ? vnDate() : undefined;
  if (id) run('UPDATE schedule SET name=?, time_vn=?, playlist_ids=?, enabled=? WHERE id=?', name, body.time_vn, JSON.stringify(body.playlist_ids), body.enabled === false ? 0 : 1, id);
  else id = run('INSERT INTO schedule (name,time_vn,playlist_ids,enabled,last_run_date_vn) VALUES (?,?,?,?,?)', name, body.time_vn, JSON.stringify(body.playlist_ids), body.enabled === false ? 0 : 1, lastRun ?? null).lastInsertRowid;
  return get('SELECT * FROM schedule WHERE id=?', id);
}
