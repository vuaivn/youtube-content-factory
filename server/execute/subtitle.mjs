// subtitle.mjs — gộp .srt của từng đoạn giọng (hook/story/outro) thành MỘT .srt cho cả video,
// cộng offset theo timeline của plan. Quy tắc anh Vũ 14/09: MỌI video phải có phụ đề burn-in.
// Đầu vào: plan.timeline (voice segment có source.file_path), mỗi file giọng có .srt cùng tên.
import fs from 'node:fs';

const T = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/;
function parseTime(s) {
  const m = T.exec(s.trim());
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
}
function fmtTime(t) {
  if (t < 0) t = 0;
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}
export function parseSrt(text) {
  // trả [{start,end,lines:[]}] — bỏ index, chịu được BOM/CRLF
  const cues = [];
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\n+/);
  for (const b of blocks) {
    const lines = b.split('\n').filter(l => l.trim() !== '');
    if (!lines.length) continue;
    let i = 0;
    if (/^\d+$/.test(lines[0].trim())) i = 1;
    const tm = (lines[i] ?? '').split('-->');
    if (tm.length !== 2) continue;
    const start = parseTime(tm[0]), end = parseTime(tm[1]);
    if (start == null || end == null) continue;
    cues.push({ start, end, lines: lines.slice(i + 1) });
  }
  return cues;
}
export function srtForVoiceSegment(voicePath) {
  const cand = voicePath.replace(/\.[^.]+$/, '.srt');
  return fs.existsSync(cand) ? cand : null;
}
// Gộp: từng đoạn voice trong timeline → đọc .srt của nó, cộng start_s, cắt cue vượt quá đoạn.
// Trả { ok, srt_path?, missing: [file thiếu .srt] }
const VOICE_KINDS = new Set(['hook', 'story', 'outro']);
export function buildMergedSrt(plan, outPath) {
  const voiceSegs = plan.timeline
    .filter(s => VOICE_KINDS.has(s.kind) && (s.source?.file ?? s.source?.file_path))
    .map(s => ({ ...s, source: { ...s.source, file_path: s.source.file ?? s.source.file_path } }));
  const missing = [];
  let all = [];
  for (const seg of voiceSegs) {
    const sp = srtForVoiceSegment(seg.source.file_path);
    if (!sp) { missing.push(seg.source.file_path); continue; }
    const cues = parseSrt(fs.readFileSync(sp, 'utf8'));
    const segLen = seg.end_s - seg.start_s;
    for (const c of cues) {
      if (c.start >= segLen) continue;              // cue nằm ngoài phần dùng
      const end = Math.min(c.end, segLen);
      all.push({ start: c.start + seg.start_s, end: end + seg.start_s, lines: c.lines });
    }
  }
  if (!all.length) return { ok: false, missing, error: 'Không gộp được cue nào' };
  all.sort((a, b) => a.start - b.start);
  const out = all.map((c, i) => `${i + 1}\n${fmtTime(c.start)} --> ${fmtTime(c.end)}\n${c.lines.join('\n')}`).join('\n\n') + '\n';
  fs.writeFileSync(outPath, out, 'utf8');
  return { ok: true, srt_path: outPath, cue_count: all.length, missing };
}
