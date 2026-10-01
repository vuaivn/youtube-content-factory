// usage.mjs — Ghi usage_log CHỈ KHI job thành công (done).
// Nguyên tắc (advisor 28/09): KHÔNG ghi lúc tạo plan — job fail sẽ "đốt oan"
// tài nguyên chưa hề lên video. Job 7-9 fail không đốt gì nhờ nguyên tắc này.
import { run as dbRun, get } from '../db/db.mjs';

export function recordUsage(jobId) {
  const job = get('SELECT * FROM job WHERE id=?', jobId);
  if (!job) throw new Error('Không có job ' + jobId);
  if (job.status !== 'done') throw new Error(`Chỉ ghi usage cho job done (job ${jobId} đang ${job.status})`);
  // Idempotent: goi 2 lan (verify pass + sau upload) khong ghi doi (advisor 28/09)
  const already = get('SELECT COUNT(*) AS n FROM usage_log WHERE job_id=?', jobId);
  if (already?.n > 0) return { recorded: 0, skipped: 'da ghi truoc do' };
  const plan = JSON.parse(job.plan_json);
  const seen = new Set();
  let n = 0;
  for (const seg of plan.timeline ?? []) {
    const aid = seg.source?.id;
    if (!aid || seen.has(aid)) continue;
    seen.add(aid);
    dbRun('INSERT INTO usage_log (asset_id, playlist_id, job_id) VALUES (?,?,?)', aid, job.playlist_id, jobId);
    n++;
  }
  return { recorded: n };
}
