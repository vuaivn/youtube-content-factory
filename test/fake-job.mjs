// fake-job.mjs — tiến trình GIẢ thay run-job.mjs để thử bộ giám sát (không dựng, không upload).
// Hành vi theo vị trí trong chuỗi: YCF_FAKE_PLAN="ok,fail,hang,ok" ('slow' = chạy 12s rồi xong).
import fs from 'node:fs';
import path from 'node:path';
import { get, run, openDb } from '../server/db/db.mjs';
openDb().exec('PRAGMA busy_timeout=15000');
const id = Number(process.argv[process.argv.indexOf('--item') + 1]);
const it = get('SELECT * FROM chain_item WHERE id=?', id);
const mode = (process.env.YCF_FAKE_PLAN ?? 'ok').split(',')[it.position - 1] ?? 'ok';
run("UPDATE chain_item SET status='running', stage='Giả lập: ' || ? WHERE id=?", mode, id);
const jobId = run("INSERT INTO job (playlist_id,status,plan_json) VALUES (?, 'rendering', '{}')", it.playlist_id).lastInsertRowid;
run('UPDATE chain_item SET job_id=? WHERE id=?', jobId, id);
const out = path.join('C:/tmp/ycf-run', `${it.playlist_id}-job${jobId}`);
fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'rac.bin'), Buffer.alloc(1024 * 1024));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const finish = st => { fs.rmSync(out, { recursive: true, force: true });
  run("UPDATE job SET status=?, finished_at=datetime('now') WHERE id=?", st === 'done' ? 'done' : 'failed', jobId);
  run("UPDATE chain_item SET status=?, error=?, pid=NULL, finished_at=datetime('now') WHERE id=?", st, st === 'failed' ? 'lỗi giả lập' : null, id); };
if (mode === 'hang') { await sleep(3600e3); }                 // đứng im: không CPU, không ghi file
else if (mode === 'fail') { await sleep(2000); finish('failed'); }
else { for (let i = 0; i < (mode === 'slow' ? 12 : 3); i++) { await sleep(1000); fs.appendFileSync(path.join(out, 'rac.bin'), 'x'); } finish('done'); }
process.exit(0);
