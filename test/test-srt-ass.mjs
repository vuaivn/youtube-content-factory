// test-srt-ass.mjs - chuyển định dạng màu SRT -> ASS (video thủ công). Không cần server.
import { srtLineToAss, buildAss } from '../server/recipe/manual-style.mjs';
let pass = 0, fail = 0; const eq = (a, b, m) => { const c = a === b; c ? pass++ : fail++; console.log((c ? '  DAT   ' : '  TRUOT ') + m + (c ? '' : `\n    got: ${a}\n    exp: ${b}`)); };

eq(srtLineToAss('<font color="#FF8C1A">Bố thí,</font> bố thí'), '{\\c&H1A8CFF&}Bố thí,{\\c} bố thí', 'font color đơn');
eq(srtLineToAss('a <font color="#FF0000">x</font> b <font color="#00FF00">y</font> c'), 'a {\\c&H0000FF&}x{\\c} b {\\c&H00FF00&}y{\\c} c', 'nhiều màu 1 dòng');
eq(srtLineToAss('<font color="#FF0000">a <font color="#0000FF">b</font> c</font>'), '{\\c&H0000FF&}a {\\c&HFF0000&}b{\\c&H0000FF&} c{\\c}', 'lồng nhau trả màu ngoài');
eq(srtLineToAss('<b>x</b><i>y</i><u>z</u>'), '{\\b1}x{\\b0}{\\i1}y{\\i0}{\\u1}z{\\u0}', 'b/i/u');
eq(srtLineToAss('{\\c&H00FFFF&}giữ{\\c} <span>lạ</span> {rời}'), '{\\c&H00FFFF&}giữ{\\c} lạ rời', 'giữ ASS, bỏ tag lạ');
eq(srtLineToAss('<font face="Arial">k</font>'), 'k', 'font không màu');
const ass = buildAss([{ start: 65.5, end: 70, lines: ['<font color="#FF8C1A">A</font>', 'b'] }], { box: false }, 1920, 1080);
eq(/Dialogue: 0,0:01:05\.50,0:01:10\.00,Default,,0,0,0,,\{\\c&H1A8CFF&\}A\{\\c\}\\Nb/.test(ass), true, 'offset + dialogue');
eq(/PlayResX: 1920\nPlayResY: 1080/.test(ass), true, 'PlayRes');
const boxed = buildAss([{ start: 0, end: 1, lines: ['x'] }], { box: true, boxOpacity: 0.5 }, 1920, 1080);
eq(/Style: Box,.*,&HFF000000,&H000000FF,&H80000000,&H80000000,.*,3,12,0,2,/.test(boxed), true, 'box BorderStyle=3 + alpha + đệm');
const hb = buildAss([{ start: 0, end: 1, lines: ['a <font color="#FF8C1A">x</font> b'] }], { box: true }, 1920, 1080);
eq(hb.includes('Dialogue: 0,0:00:00.00,0:00:01.00,Box,,0,0,0,,a x b') && hb.includes('Dialogue: 1,0:00:00.00,0:00:01.00,Default,,0,0,0,,a {\\c&H1A8CFF&}x{\\c} b'), true, 'hộp 2 lớp: lớp hộp không tag màu (không vệt)');
eq(/Style: Default,Arial,88,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,.*,1,2.5,0,2,115,115,70,/.test(hb), true, 'mặc định: đậm 88, lề 70, viền mảnh trong hộp');
const A = buildAss([{ start: 0, end: 1, lines: ['x'] }], { box: false }, 1920, 1080);
eq(/Style: Default,Arial,88,&H00FFFFFF,&H000000FF,&H00000000,&H60000000,-1,.*,1,5,2,2,/.test(A) && !A.includes('Style: Box'), true, 'kiểu A: viền 5 + bóng 2');
console.log(`\n${pass} đạt, ${fail} trượt`); process.exit(fail ? 1 : 0);
