// list-release-files.mjs — danh sách file ĐƯỢC đưa lên git (theo .gitignore) + quét chặn bí mật.
// node tools/list-release-files.mjs [--copy <thư-mục-đích>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
const toRe = r => new RegExp('^' + r.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\/$/, '(/.*)?') + '$');
const res = rules.map(r => ({ r, re: toRe(r.replace(/^\//, '')), base: !r.includes('/') || r.endsWith('/') && r.indexOf('/') === r.length - 1 }));
const ignored = rel => res.some(({ re, base }) => re.test(rel) || (base && rel.split('/').some((_, i, a) => re.test(a.slice(0, i + 1).join('/')) || re.test(a[i]))));
const out = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name), rel = path.relative(ROOT, p).replace(/\\/g, '/');
    if (ignored(rel)) continue;
    e.isDirectory() ? walk(p) : out.push(rel);
  }
})(ROOT);
// chặn bí mật: refresh_token / client_secret thật / mã bot Telegram
const SECRET = /(1\/\/0[\w-]{20,}|GOCSPX-[\w-]{10,}|\d{8,10}:AA[\w-]{30,}|"refresh_token"\s*:\s*"[^"]{20,})/;
const leaks = out.filter(f => SECRET.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
if (leaks.length) { console.error('CHẶN: file chứa bí mật:', leaks); process.exit(1); }
const i = process.argv.indexOf('--copy');
if (i > 0) { const dst = process.argv[i + 1]; for (const f of out) { fs.mkdirSync(path.dirname(path.join(dst, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(dst, f)); } }
console.log(JSON.stringify({ count: out.length, files: out }, null, 1));
