// test-srt-ass.mjs - chuyển định dạng màu SRT -> ASS (video thủ công). Không cần server.
import { srtLineToAss, buildAss } from '../server/recipe/manual-style.mjs';
let pass = 0, fail = 0; const eq = (a, b, m) => { const c = a === b; c ? pass++ : fail++; console.log((c ? '  DAT   ' : '  TRUOT ') + m + (c ? '' : `\n    got: ${a}\n    exp: ${b}`)); };

eq(srtLineToAss('<font color="#FF8C1A">Bố thí,</font> bố thí'), '{\\c&H1A8CFF&}Bố thí,{\\c} bố thí', 'font color đơn');
eq(srtLineToAss('a <font color="#FF0000">x</font> b <font color="#00FF00">y</font> c'), 'a {\\c&H0000FF&}x{\\c} b {\\c&H00FF00&}y{\\c} c', 'nhiều màu 1 dòng');
eq(srtLineToAss('<font color="#FF0000">a <font color="#0000FF">b</font> c</font>'), '{\\c&H0000FF&}a {\\c&HFF0000&}b{\\c&H0000FF&} c{\\c}', 'lồng nhau trả màu ngoài');
eq(srtLineToAss('<b>x</b><i>y</i><u>z</u>'), '{\\b1}x{\\b0}{\\i1}y{\\i0}{\\u1}z{\\u0}', 'b/i/u');
eq(srtLineToAss('{\\c&H00FFFF&}giữ{\\c} <span>lạ</span> {rời}'), '{\\c&H00FFFF&}giữ{\\c} lạ rời', 'giữ ASS, bỏ tag lạ');
eq(srtLineToAss('<font face="Arial">k</font>'), 'k', 'font không màu');
const ass = buildAss([{ start: 65.5, end: 70, lines: ['<font color="#FF8C1A">A</font>', 'b'] }], {}, 1920, 1080);
eq(/Dialogue: 0,0:01:05\.50,0:01:10\.00,Default,,0,0,0,,\{\\c&H1A8CFF&\}A\{\\c\}\\Nb/.test(ass), true, 'offset + dialogue');
eq(/PlayResX: 1920\nPlayResY: 1080/.test(ass), true, 'PlayRes');
const boxed = buildAss([{ start: 0, end: 1, lines: ['x'] }], { box: true, boxOpacity: 0.5 }, 1920, 1080);
eq(/,3,8,0,2,/.test(boxed) && /,&H80000000,&H80000000,/.test(boxed), true, 'box BorderStyle=3 + alpha');
console.log(`\n${pass} đạt, ${fail} trượt`); process.exit(fail ? 1 : 0);
