#!/usr/bin/env node
/**
 * canh-dia.mjs — Bo canh o dia chay SONG SONG voi compose.mjs.
 *
 * VI SAO CAN:
 *   compose.mjs goi ffmpeg bang spawnSync (dong bo) nen KHONG the kiem o dia
 *   trong luc ffmpeg dang ghi. Dem 27/09: ffmpeg ghi lien tuc mấy chuc phut,
 *   o dia tut tu 3 GB xuong 0 GB, khong ai chan -> mat 2 kenh video.
 *   Guard cu chi kiem TRUOC moi buoc, phat hien SAU KHI da can.
 *
 * CACH LAM:
 *   Cu 5 giay kiem o dia. Neu xuong duoi nguong -> giet moi tien trinh ffmpeg
 *   dang ghi vao thu muc lam viec, roi thoat voi ma 9.
 *   Tha dung video dang dung con hon de o C can kiet (lenh anh Vu).
 *
 * Chay:  node canh-dia.mjs <thu-muc-lam-viec> [nguongGB]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const WORK = process.argv[2];
const NGUONG = Number(process.argv[3] || 1.5);   // GB — tren muc 1 GB anh Vu dan
const GOC = path.parse(path.resolve(WORK || 'C:/')).root;

const diaGB = () => {
  try { const s = fs.statfsSync(GOC); return s.bavail * s.bsize / 1073741824; }
  catch { return null; }
};

const ghi = m => {
  const d = `[canh-dia] ${m}`;
  console.log(d);
  try { fs.appendFileSync(path.join(WORK, 'canh-dia.log'), d + '\n'); } catch {}
};

function gietFfmpeg() {
  // CHI giet ffmpeg CUA RUN NAY (dong lenh co chua thu muc lam viec).
  // Neu giet bua moi ffmpeg thi job khac dang chay (cron phu de, kenh khac)
  // se bi va lay.
  const loc = String(WORK).replace(/\\/g, '\\\\').replace(/'/g, "''");
  const ps = `Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" | ` +
             `Where-Object { $_.CommandLine -like '*${loc}*' } | ` +
             `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue; $_.ProcessId }`;
  try {
    const ra = execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8', timeout: 30000 }).trim();
    ghi(ra ? `da dung ffmpeg cua run nay: pid ${ra.split(/\s+/).join(', ')}` : 'khong thay ffmpeg nao cua run nay');
  } catch (e) { ghi('khong giet duoc ffmpeg: ' + (e.message || '').slice(0, 80)); }
}

ghi(`bat dau canh ${GOC} — nguong ${NGUONG} GB — thu muc ${WORK}`);
let thap = 99;

const hen = setInterval(() => {
  const g = diaGB();
  if (g == null) return;
  if (g < thap) thap = g;

  if (g < NGUONG) {
    ghi(`!! O DIA CON ${g.toFixed(2)} GB < nguong ${NGUONG} GB -> DUNG FFMPEG NGAY`);
    gietFfmpeg();
    ghi(`da dung. O dia thap nhat ghi nhan: ${thap.toFixed(2)} GB`);
    clearInterval(hen);
    process.exit(9);
  }
}, 5000);

// Thoat sach khi compose.mjs ket thuc
process.on('SIGTERM', () => { clearInterval(hen); ghi(`ket thuc — dia thap nhat ${thap.toFixed(2)} GB`); process.exit(0); });
process.on('SIGINT', () => { clearInterval(hen); process.exit(0); });
