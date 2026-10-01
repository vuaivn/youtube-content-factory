// test-b3.mjs — thử BỘ GIÁM SÁT CHUỖI bằng tiến trình giả (không dựng, không upload, không Telegram).
// PHẢI tắt server trước (tránh hai bộ giám sát cùng chạy trên một DB). Chạy: node test/test-b3.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
process.env.YCF_RUN_JOB = path.join(HERE, 'fake-job.mjs');
process.env.YCF_STALL_MS = '20000';
process.env.YCF_NO_TELEGRAM = '1';
const { get, all, run, openDb } = await import('../server/db/db.mjs');
const Q = await import('../server/execute/queue.mjs');
const { vnTime, vnDate } = await import('../server/execute/notify.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  DAT   ' : '  TRUOT ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = p => { try { process.kill(p, 0); return true; } catch { return false; } };
Q.dbConcurrency(); (await import('../server/migrate/m3-queue.mjs')).migrateQueue();
const before = { chain: get('SELECT COALESCE(MAX(id),0) m FROM chain').m, job: get('SELECT COALESCE(MAX(id),0) m FROM job').m, sch: get('SELECT COALESCE(MAX(id),0) m FROM schedule').m };
let maxRunning = 0;
const watch = setInterval(() => { const n = get("SELECT COUNT(*) n FROM chain_item WHERE status='running'").n; maxRunning = Math.max(maxRunning, n); }, 300);
const tick = setInterval(() => Q.tick(), 1500);
const waitFor = async (fn, ms, step = 500) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(step); } return false; };
const pl = all('SELECT id FROM playlist ORDER BY id').map(r => r.id);

try {
  console.log('== 1. chuỗi 4 kênh: ok → lỗi → treo → ok');
  process.env.YCF_FAKE_PLAN = 'ok,fail,hang,ok';
  const c = Q.createChain({ name: '_test b3', playlistIds: pl.slice(0, 4) });
  const fin = await waitFor(() => get('SELECT status FROM chain WHERE id=?', c.id).status === 'done', 90000);
  const items = all('SELECT * FROM chain_item WHERE chain_id=? ORDER BY position', c.id);
  ok(fin, 'chuỗi kết thúc (done)');
  ok(maxRunning <= 1, `KHÔNG BAO GIỜ quá 1 kênh chạy cùng lúc (đo được tối đa ${maxRunning})`);
  ok(items.map(i => i.status).join(',') === 'done,failed,failed,done', 'kết quả đúng thứ tự: ' + items.map(i => i.status).join(','));
  ok(/Treo/.test(items[2].error ?? ''), 'kênh 3 bị bắt treo: ' + items[2].error);
  ok(items.every((it, i) => i === 0 || new Date(it.started_at + 'Z') >= new Date(items[i - 1].finished_at + 'Z')), 'kênh sau chỉ bắt đầu khi kênh trước đã kết thúc');
  const gaps = items.slice(1).map((it, i) => (new Date(it.started_at + 'Z') - new Date(items[i].finished_at + 'Z')) / 1000);
  ok(gaps.every(g => g <= 5), 'khoảng chờ giữa hai kênh ≤ 5 giây: ' + gaps.join('s, ') + 's');
  ok(items.every(i => !fs.existsSync(path.join('C:/tmp/ycf-run', `${i.playlist_id}-job${i.job_id}`))), 'thư mục tạm của cả 4 kênh đã dọn (kể cả kênh treo bị giết)');
  const { spawnSync } = await import('node:child_process');
  const left = spawnSync('powershell', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ? CommandLine -match 'fake-job' | Measure).Count"], { encoding: 'utf8' }).stdout.trim();
  ok(left === '0' && items.every(i => i.pid == null), 'tiến trình kênh treo đã bị giết: còn ' + left + ' tiến trình giả đang sống');
  ok(fs.existsSync(c.log_file) && items.every(i => fs.existsSync(i.log_file)), 'có file log chuỗi + log từng kênh');
  const cl = fs.readFileSync(c.log_file, 'utf8');
  ok(/TỔNG KẾT/.test(cl) && /^\[\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d\]/m.test(cl), 'log chuỗi có tổng kết, dòng ghi giờ dạng dd/mm/yyyy (giờ VN)');
  ok(items.every(i => i.notified === 1), 'cả 4 kênh đã qua bước báo (Telegram tắt khi test)');

  console.log('== 2. xếp hàng: chuỗi thứ hai chờ chuỗi đầu');
  process.env.YCF_FAKE_PLAN = 'slow';
  const a = Q.createChain({ name: '_test b3 A', playlistIds: [pl[0]] });
  const b = Q.createChain({ name: '_test b3 B', playlistIds: [pl[1]] });
  await waitFor(() => get('SELECT status FROM chain WHERE id=?', a.id).status === 'running', 10000);
  await sleep(4000);
  ok(get('SELECT status FROM chain WHERE id=?', b.id).status === 'queued', 'chuỗi B vẫn XẾP HÀNG khi A đang chạy');
  await waitFor(() => get('SELECT status FROM chain WHERE id=?', b.id).status === 'done', 60000);
  ok(get('SELECT status FROM chain WHERE id=?', b.id).status === 'done', 'A xong → B tự chạy và xong');

  console.log('== 3. tạm dừng / chạy tiếp / huỷ');
  process.env.YCF_FAKE_PLAN = 'slow,slow,slow';
  const p = Q.createChain({ name: '_test b3 P', playlistIds: pl.slice(0, 3) });
  await waitFor(() => get("SELECT COUNT(*) n FROM chain_item WHERE chain_id=? AND status='running'", p.id).n === 1, 10000);
  Q.pauseChain(p.id);
  await waitFor(() => get("SELECT status FROM chain_item WHERE chain_id=? AND position=1", p.id).status === 'done', 30000);
  await sleep(4000);
  ok(get("SELECT status FROM chain_item WHERE chain_id=? AND position=2", p.id).status === 'pending', 'tạm dừng: kênh đang chạy làm xong, kênh kế KHÔNG bắt đầu');
  Q.resumeChain(p.id);
  await waitFor(() => get("SELECT status FROM chain_item WHERE chain_id=? AND position=2", p.id).status === 'running', 10000);
  ok(get("SELECT status FROM chain_item WHERE chain_id=? AND position=2", p.id).status === 'running', 'chạy tiếp: kênh 2 bắt đầu');
  const run2 = get("SELECT * FROM chain_item WHERE chain_id=? AND position=2", p.id);
  await sleep(1500);
  Q.cancelChain(p.id);
  const it2 = get('SELECT * FROM chain_item WHERE id=?', run2.id);
  ok(it2.status === 'cancelled' && !alive(run2.pid) && get("SELECT status FROM chain_item WHERE chain_id=? AND position=3", p.id).status === 'cancelled', 'huỷ: giết kênh đang chạy, các kênh chờ thành "đã huỷ"');
  const job2 = get('SELECT job_id FROM chain_item WHERE id=?', run2.id).job_id;
  ok(!job2 || !fs.existsSync(path.join('C:/tmp/ycf-run', `${run2.playlist_id}-job${job2}`)), 'huỷ: đã dọn file tạm của kênh bị huỷ');

  console.log('== 4. tiến trình chết bất thường (mô phỏng server/máy khởi động lại)');
  process.env.YCF_FAKE_PLAN = 'hang,ok';
  const k = Q.createChain({ name: '_test b3 K', playlistIds: pl.slice(0, 2) });
  await waitFor(() => (get("SELECT pid FROM chain_item WHERE chain_id=? AND position=1", k.id)?.pid ?? 0) > 0, 10000);
  process.kill(get("SELECT pid FROM chain_item WHERE chain_id=? AND position=1", k.id).pid);
  await waitFor(() => get('SELECT status FROM chain WHERE id=?', k.id).status === 'done', 30000);
  const ki = all('SELECT * FROM chain_item WHERE chain_id=? ORDER BY position', k.id);
  ok(ki[0].status === 'failed' && /bất thường/.test(ki[0].error) && ki[1].status === 'done', 'PID chết → ghi lỗi, dọn, chạy kênh kế');

  console.log('== 5. lịch hẹn giờ Việt Nam');
  const sid = run("INSERT INTO schedule (name,time_vn,playlist_ids,enabled) VALUES ('_test lịch', ?, ?, 1)", vnTime(), JSON.stringify([pl[0]])).lastInsertRowid;
  process.env.YCF_FAKE_PLAN = 'ok';
  await Q.tick();
  const sc = get("SELECT * FROM chain WHERE schedule_id=? ORDER BY id DESC", sid);
  ok(sc && sc.source === 'schedule' && get('SELECT last_run_date_vn d FROM schedule WHERE id=?', sid).d === vnDate(), `đến giờ ${vnTime()} (VN) → tạo chuỗi theo lịch, đánh dấu đã chạy hôm nay`);
  await Q.tick();
  ok(get('SELECT COUNT(*) n FROM chain WHERE schedule_id=?', sid).n === 1, 'không tạo trùng trong cùng ngày');
  await waitFor(() => get('SELECT status FROM chain WHERE id=?', sc.id).status === 'done', 20000);
  const s2 = Q.saveSchedule({ name: '_test lịch 2', time_vn: '00:00', playlist_ids: [pl[0]] });
  ok(s2.last_run_date_vn === vnDate(), 'tạo lịch khi đã quá giờ hôm nay → không chạy bù ngay, bắt đầu từ ngày mai');
} finally {
  clearInterval(watch); clearInterval(tick);
  // dọn dữ liệu thử
  const cids = all('SELECT id FROM chain WHERE id>?', before.chain).map(r => r.id);
  for (const id of cids) {
    for (const it of all('SELECT * FROM chain_item WHERE chain_id=?', id)) { try { fs.rmSync(it.log_file, { force: true }); } catch {} if (it.pid) try { process.kill(it.pid); } catch {} }
    try { fs.rmSync(get('SELECT log_file f FROM chain WHERE id=?', id).f, { force: true }); } catch {}
    run('DELETE FROM chain_item WHERE chain_id=?', id); run('DELETE FROM chain WHERE id=?', id);
  }
  run('DELETE FROM job_step WHERE job_id>?', before.job); run('DELETE FROM job WHERE id>?', before.job);
  run('DELETE FROM schedule WHERE id>?', before.sch);
  console.log(`\n${pass} DAT / ${fail} TRUOT · đã dọn ${cids.length} chuỗi thử`);
  process.exit(fail ? 1 : 0);
}
