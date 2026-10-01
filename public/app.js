// app.js — YouTube Content Factory UI (thuần JS, không framework).
// 4 trang: Kênh&Playlist (cây, hết PQTA 2 lần) · Kho tài nguyên (CRUD) · Kho chữ&SEO (CRUD) · Sản xuất.
const $ = s => document.querySelector(s);
const el = (t, attrs = {}, ...kids) => {
  const e = document.createElement(t);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'onclick') e.onclick = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) { toast(j.error ?? r.status, true); throw new Error(j.error); }
  return j;
}
function toast(msg, bad = false) {
  const t = el('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
  document.body.append(t); setTimeout(() => t.remove(), bad ? 6000 : 2500);
}
function modal(...content) {
  $('#modal').classList.remove('wide');
  $('#modal').replaceChildren(...content);
  $('#modal-wrap').classList.remove('hidden');
}
function closeModal() { $('#modal-wrap').classList.add('hidden'); }
$('#modal-wrap').addEventListener('click', e => { if (e.target.id === 'modal-wrap') closeModal(); });
const fmtMin = m => m == null ? '—' : (m >= 60 ? (m / 60).toFixed(1) + ' giờ' : Math.round(m) + ' phút');

// ================= TRANG KÊNH & PLAYLIST =================
async function pageChannels() {
  const chans = await api('GET', '/api/channel');
  const main = el('div', {},
    el('div', { class: 'row' }, el('h2', { class: 'grow' }, 'Kênh & Playlist'),
      el('button', { class: 'btn', onclick: async e => { e.target.disabled = true; e.target.textContent = 'Đang kiểm…';
        const r = await api('POST', '/api/channel/check-tokens');
        toast(r.map(x => `${x.name}: ${x.status === 'valid' ? 'OK' : 'HẾT HẠN'}`).join(' · '), r.some(x => x.status !== 'valid')); nav('channels'); } }, '🔍 Kiểm tra đăng nhập tất cả kênh'),
      el('button', { class: 'btn primary', onclick: () => oauthForm(null) }, '➕ Thêm kênh mới')),
    el('p', { class: 'mut' }, 'Mỗi kênh hiện MỘT lần; playlist là nhánh con. Cấu hình sản xuất nằm ở playlist.'));
  for (const c of chans) {
    const box = el('div', { class: 'card' });
    box.append(el('div', { class: 'row' },
      el('strong', {}, c.name),
      el('span', { class: 'badge' }, (c.subscriber_count ?? '?') + ' subs'),
      el('span', { class: 'badge ' + (c.token_status === 'valid' ? 'good' : 'bad') }, c.token_status === 'valid' ? 'đăng nhập OK' : 'HẾT HẠN đăng nhập'),
      el('button', { class: 'btn sm' + (c.token_status === 'valid' ? '' : ' danger'), onclick: () => oauthForm(c) }, '🔄 Đăng nhập lại'),
      el('button', { class: 'btn sm', onclick: () => archiveChannel(c) }, '🗄 Lưu trữ'),
      el('span', { class: 'grow' }),
      el('button', { class: 'btn sm', onclick: () => addPlaylist(c) }, '+ Thêm playlist')));
    api('GET', `/api/channel/${c.id}/playlist`).then(pls => {
      for (const p of pls) box.append(el('div', { class: 'tree-pl' },
        el('span', {}, p.enabled ? '🟢' : '⚪'),
        el('strong', { class: 'grow' }, p.name),
        el('span', { class: 'mut' }, p.id),
        el('button', { class: 'btn sm', onclick: () => editPlaylist(p.id) }, 'Sửa'),
        el('button', { class: 'btn sm', onclick: () => clonePlaylist(p) }, 'Nhân bản'),
        el('button', { class: 'btn sm', onclick: () => delPlaylist(p) }, '🗄 Lưu trữ')));
    });
    main.append(box);
  }
  return main;
}
// ---- Đăng nhập kênh (lại) / thêm kênh mới: mở Google → dán URL trang lỗi 127.0.0.1 → lưu ----
function oauthForm(ch) {
  const isNew = !ch;
  const idIn = inp(''); idIn.placeholder = 'vd: abc (chữ thường, số, gạch ngang)';
  const paste = el('textarea', { rows: '3', placeholder: 'Dán TOÀN BỘ địa chỉ trang lỗi, bắt đầu bằng http://127.0.0.1:8737/?state=…&code=…' });
  const openBtn = el('button', { class: 'btn primary', onclick: async () => {
    const r = await api('POST', '/api/oauth/start', isNew ? { new_id: idIn.value.trim() } : { channel_id: ch.id });
    window.open(r.url, '_blank'); openBtn.textContent = '↻ Mở lại trang Google';
  } }, '1. Mở trang đăng nhập Google');
  modal(el('h3', {}, isNew ? 'Thêm kênh mới' : 'Đăng nhập lại: ' + ch.name),
    ...(isNew ? [el('div', {}, el('label', {}, 'Mã kênh trong app'), idIn)] : []),
    el('ol', { class: 'steps' },
      el('li', {}, 'Bấm nút bên dưới → chọn ĐÚNG tài khoản Google của kênh' + (isNew ? '' : ' "' + ch.name + '"') + ' → Cho phép.'),
      el('li', {}, 'Google chuyển sang trang lỗi "không kết nối được" — BÌNH THƯỜNG. Copy toàn bộ địa chỉ trên thanh URL.'),
      el('li', {}, 'Dán vào ô dưới rồi bấm Lưu. App tự kiểm đúng kênh mới ghi, và sao lưu file đăng nhập cũ.')),
    el('div', { class: 'row' }, openBtn), el('label', {}, '2. Dán địa chỉ'), paste,
    el('div', { class: 'row', style: 'margin-top:12px' },
      el('button', { class: 'btn primary', onclick: async () => {
        const r = await api('POST', '/api/oauth/finish', { pasted: paste.value });
        closeModal(); toast((r.mode === 'new' ? 'Đã thêm kênh ' : 'Đã đăng nhập lại ') + r.title); nav('channels');
      } }, 'Lưu'),
      el('button', { class: 'btn', onclick: closeModal }, 'Đóng')));
}
const addPlaylist = chan => playlistForm(chan, null);
const editPlaylist = async id => { const p = await api('GET', '/api/playlist/' + id); playlistForm({ id: p.channel_id }, p); };
async function clonePlaylist(p) {
  const nid = prompt('Mã playlist mới (chữ thường, số, gạch ngang):', p.id + '-copy');
  if (!nid) return;
  await api('POST', `/api/playlist/${p.id}/clone`, { new_id: nid.trim() });
  toast('Đã nhân bản — công thức và kho được SAO CHÉP riêng, mặc định TẮT'); nav('channels');
}
// 30/09: Xoá → LƯU TRỮ (không mất gì, khôi phục ở mục Lưu trữ)
async function delPlaylist(p) {
  if (!confirm(`Lưu trữ playlist "${p.name}"?\nPlaylist ẩn khỏi danh sách và không chạy nữa. Khôi phục được ở mục 🗄 Lưu trữ.`)) return;
  await api('POST', `/api/playlist/${p.id}/archive`);
  toast('Đã lưu trữ playlist'); nav('channels');
}
async function archiveChannel(c) {
  if (!confirm(`Lưu trữ kênh "${c.name}" cùng ${c.playlist_count} playlist?\nKhông mất dữ liệu, không đụng YouTube. Khôi phục được ở mục 🗄 Lưu trữ.`)) return;
  await api('POST', `/api/channel/${c.id}/archive`);
  toast('Đã lưu trữ kênh ' + c.name); nav('channels');
}
async function archivePool(p) {
  if (!confirm(`Lưu trữ kho "${p.name}"?\nFile trên ổ giữ nguyên. Playlist sẽ không bốc từ kho này nữa. Khôi phục được ở mục 🗄 Lưu trữ.`)) return;
  let r = await api('POST', `/api/pool/${p.id}/archive`, {});
  if (r.need_confirm) {
    if (!confirm(`⚠ Các playlist sau sẽ KHÔNG CÒN kho ${r.kind} nào:\n${r.orphan.map(o => '• ' + o.name).join('\n')}\nChúng sẽ không dựng được cho tới khi gán kho khác. Vẫn lưu trữ?`)) return;
    r = await api('POST', `/api/pool/${p.id}/archive`, { confirm: true });
  }
  toast('Đã lưu trữ kho ' + p.name); nav('pools');
}

// ---- Form playlist (tạo mới p=null / sửa): thông tin · công thức · nâng cao · kho · xem trước ----
async function playlistForm(chan, p) {
  const isNew = !p;
  const fm = p?.formula ?? { total_min: 240, story_mode: 'fill', story_count: 1, hook: true, outro: true, gap_s: 2,
    bg_min: 5, black_min: 120, max_voice_pct: 55, fade_out_s: 120, silence_s: 3, fade_in_s: 90, fade_end_s: 15 };
  const [pools, textPools] = await Promise.all([api('GET', '/api/pool'), api('GET', `/api/channel/${chan.id}/textpool`)]);
  const chosen = new Set((p?.pools ?? []).map(x => x.pool_id));
  const unused = Object.fromEntries((p?.pools ?? []).map(x => [x.pool_id, x.unused_count]));
  const f = {};
  const num = v => { const i = el('input', { type: 'number', step: 'any', min: '0' }); i.value = v ?? ''; return i; };
  const chk = v => { const i = el('input', { type: 'checkbox' }); i.checked = !!v; return i; };

  // --- kho: ô tick theo nhóm ---
  const poolBoxes = {};
  const poolSection = el('div', {});
  for (const kind of ['hook', 'story', 'outro', 'shot', 'music']) {
    const list = pools.filter(x => x.kind === kind && x.enabled !== 0);
    const box = el('div', { class: 'poolgroup' }, el('div', { class: 'poolgroup-h' }, POOL_NAME[kind] ?? kind));
    if (!list.length) box.append(el('div', { class: 'mut' }, 'Chưa có kho — tạo ở trang Kho tài nguyên'));
    for (const x of list) {
      const c = chk(chosen.has(x.id)); poolBoxes[x.id] = c;
      const u = unused[x.id];
      box.append(el('label', { class: 'ck' }, c, el('span', { class: 'grow' }, x.name),
        el('span', { class: 'mut' }, `${x.asset_count} mục · ${fmtMin(x.total_minutes)}`),
        u == null ? null : el('span', { class: 'badge ' + (u === 0 ? 'bad' : 'good') }, u + ' chưa dùng')));
    }
    poolSection.append(box);
  }

  // --- công thức ---
  f.total = num(fm.total_min); f.mode = sel([['fill', 'Tự thêm truyện cho đủ thời lượng'], ['fixed', 'Cố định số truyện']], fm.story_mode);
  f.count = num(fm.story_count); f.hook = chk(fm.hook); f.outro = chk(fm.outro);
  f.bg = num(fm.bg_min); f.black = num(fm.black_min);
  f.gap = num(fm.gap_s); f.ratio = num(fm.max_voice_pct);
  f.f1 = num(fm.fade_out_s); f.f2 = num(fm.silence_s); f.f3 = num(fm.fade_in_s); f.f4 = num(fm.fade_end_s);
  const countRow = el('div', {}, el('label', {}, 'Số truyện'), f.count);
  const syncMode = () => { countRow.style.display = f.mode.value === 'fixed' ? '' : 'none'; };
  f.mode.onchange = syncMode; syncMode();

  // --- thông tin ---
  f.id = inp(''); f.name = inp(p?.name ?? ''); f.yt = inp(p?.youtube_playlist_id ?? ''); f.ytn = inp(p?.youtube_playlist_name ?? '');
  f.en = sel([['1', 'Bật'], ['0', 'Tắt']], String(p?.enabled ?? 1));
  f.priv = sel([['private', 'Riêng tư'], ['unlisted', 'Không công khai'], ['public', 'Công khai']], p?.privacy ?? 'private');
  f.dedupe = sel([['playlist', 'Playlist này'], ['channel', 'Cả kênh']], p?.dedupe_scope ?? 'playlist');
  f.tp = sel([['', '— chưa chọn —'], ...textPools.map(t => [t.id, t.name])], p?.text_pool_id ?? '');
  f.capd = num(p?.caption_delay_hours ?? 6); f.thoff = num(p?.thumbnail_extract_offset_s ?? 150);

  const readFormula = () => ({
    total_min: f.total.value === '' ? null : +f.total.value, story_mode: f.mode.value, story_count: +f.count.value,
    hook: f.hook.checked, outro: f.outro.checked, bg_min: +f.bg.value || 0, black_min: +f.black.value || 0,
    gap_s: +f.gap.value, max_voice_pct: +f.ratio.value,
    fade_out_s: +f.f1.value, silence_s: +f.f2.value, fade_in_s: +f.f3.value, fade_end_s: +f.f4.value,
  });
  const readPools = () => Object.entries(poolBoxes).filter(([, c]) => c.checked).map(([id]) => id);

  // --- xem trước ---
  const previewBox = el('div', { class: 'preview' }, el('p', { class: 'mut' }, 'Bấm "Xem trước" để xem dòng thời gian và 4 mốc fade trước khi lưu.'));
  const hms = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(x).padStart(2, '0'); };
  const KIND_VN = { hook: 'Hook', story: 'Chuyện', outro: 'Outro', 'tail:background': 'Hình nền + nhạc', 'tail:black': 'Màn đen + nhạc' };
  async function preview() {
    previewBox.replaceChildren(el('p', { class: 'mut' }, 'Đang tính…'));
    let r;
    try { r = await api('POST', '/api/playlist-preview', { formula: readFormula(), pool_ids: readPools(), playlist_id: p?.id, dedupe_scope: f.dedupe.value }); }
    catch { previewBox.replaceChildren(el('p', { class: 'bad' }, 'Công thức chưa hợp lệ — xem thông báo đỏ.')); return false; }
    const kids = [];
    if (!r.ok) { kids.push(el('div', { class: 'alert bad' }, 'Chưa dựng được: ' + r.errors.join(' · '))); previewBox.replaceChildren(...kids); return false; }
    const pl = r.plan;
    kids.push(el('div', { class: 'row' },
      el('span', { class: 'badge' }, 'Tổng ' + hms(pl.total_s)),
      el('span', { class: 'badge' }, 'Giọng đọc hết lúc ' + hms(pl.voice_end_s)),
      el('span', { class: 'badge' }, 'Đuôi ' + hms(pl.tail_len_s))));
    // gộp các đoạn chuyện liên tiếp thành 1 dòng cho gọn
    const rows = [];
    for (const t of pl.timeline) {
      const last = rows[rows.length - 1];
      if (last && last.kind === 'story' && t.kind === 'story') { last.end_s = t.end_s; last.n++; continue; }
      rows.push({ ...t, n: 1 });
    }
    kids.push(el('table', { class: 'tbl' }, el('tr', {}, el('th', {}, 'Đoạn'), el('th', {}, 'Từ'), el('th', {}, 'Đến'), el('th', {}, 'Dài')),
      rows.map(t => el('tr', {}, el('td', {}, (KIND_VN[t.kind] ?? t.kind) + (t.n > 1 ? ` × ${t.n}` : '')),
        el('td', {}, hms(t.start_s)), el('td', {}, hms(t.end_s)), el('td', {}, hms(t.end_s - t.start_s))))));
    const F = pl.fades;
    const fr = F.mode === 'no_tail' ? [['Fade cuối video', F.end_fade]] :
      [['Nhạc nhỏ dần sau giọng', F.out_of_body], ['Khoảng lặng', F.silence], ['Nhạc dâng lại', F.into_tail], ['Fade cuối video', F.end_fade]];
    kids.push(el('table', { class: 'tbl' }, el('tr', {}, el('th', {}, 'Mốc fade (chỉ nhạc)'), el('th', {}, 'Bắt đầu'), el('th', {}, 'Dài (giây)')),
      fr.map(([n, x]) => el('tr', {}, el('td', {}, n), el('td', {}, hms(x.start_s)), el('td', {}, String(x.dur_s))))));
    const bk = pl.timeline.find(t => t.kind === 'tail:black'), th = +f.thoff.value;
    if (th >= pl.total_s) kids.push(el('div', { class: 'alert bad' }, `Giây trích thumbnail (${th}s) vượt độ dài video`));
    else if (bk && th >= bk.start_s) kids.push(el('div', { class: 'alert bad' }, `Giây trích thumbnail (${th}s) rơi vào MÀN ĐEN (từ ${Math.round(bk.start_s)}s) — ảnh sẽ đen`));
    for (const w of r.warnings ?? []) kids.push(el('div', { class: 'alert warn' }, '⚠ ' + w));
    previewBox.replaceChildren(...kids);
    return true;
  }

  async function save() {
    const fields = { name: f.name.value.trim(), youtube_playlist_id: f.yt.value.trim() || null, youtube_playlist_name: f.ytn.value.trim() || null,
      enabled: +f.en.value, privacy: f.priv.value, dedupe_scope: f.dedupe.value, text_pool_id: f.tp.value || null,
      caption_delay_hours: +f.capd.value, thumbnail_extract_offset_s: +f.thoff.value };
    if (!fields.name) return toast('Chưa nhập tên playlist', true);
    if (!(await preview())) return toast('Kế hoạch chưa dựng được — sửa công thức/kho trước khi lưu', true);
    if (isNew) await api('POST', '/api/playlist', { id: f.id.value.trim(), channel_id: chan.id, ...fields, formula: readFormula(), pool_ids: readPools() });
    else await api('PUT', `/api/playlist/${p.id}/config`, { fields, formula: readFormula(), pool_ids: readPools() });
    closeModal(); toast('Đã lưu (có lịch sử trong DB)'); nav('channels');
  }

  modal(
    el('h3', {}, isNew ? 'Thêm playlist' : 'Sửa playlist: ' + p.name),
    el('div', { class: 'formsec' }, el('h4', {}, '1. Thông tin'),
      el('div', { class: 'grid2' },
        isNew ? el('div', {}, el('label', {}, 'Mã playlist (chữ thường, số, gạch ngang)'), f.id) : null,
        el('div', {}, el('label', {}, 'Tên hiển thị'), f.name),
        el('div', {}, el('label', {}, 'YouTube playlist ID'), f.yt),
        el('div', {}, el('label', {}, 'Tên playlist trên YouTube'), f.ytn),
        el('div', {}, el('label', {}, 'Kho chữ thumbnail + SEO'), f.tp),
        el('div', {}, el('label', {}, 'Quyền riêng tư khi upload'), f.priv),
        el('div', {}, el('label', {}, 'Giờ hẹn đăng phụ đề sau upload'), f.capd),
        el('div', {}, el('label', {}, 'Giây trích ảnh làm thumbnail'), f.thoff),
        el('div', {}, el('label', {}, 'Chống lặp trong phạm vi'), f.dedupe),
        el('div', {}, el('label', {}, 'Bật sản xuất'), f.en))),
    el('div', { class: 'formsec' }, el('h4', {}, '2. Công thức'),
      el('p', { class: 'mut' }, 'Thứ tự cố định: hook → chuyện → outro → hình nền → màn đen. Nhạc nền chạy liền mạch tới cuối (màn đen dùng tiếp nhạc của đoạn trước).'),
      el('div', { class: 'grid2' },
        el('div', {}, el('label', {}, 'Tổng thời lượng video (phút) — để trống nếu cố định số truyện và muốn tự tính'), f.total),
        el('div', {}, el('label', {}, 'Cách chọn truyện'), f.mode),
        countRow,
        el('div', {}, el('label', { class: 'ck' }, f.hook, ' Có hook'), el('label', { class: 'ck' }, f.outro, ' Có outro')),
        el('div', {}, el('label', {}, 'Hình nền sau giọng đọc (phút, tối thiểu — phần dư cộng vào đây)'), f.bg),
        el('div', {}, el('label', {}, 'Màn đen ở cuối (phút, 0 = không có)'), f.black))),
    el('details', { class: 'formsec' }, el('summary', {}, '3. Nâng cao (mặc định đang chạy tốt, ít khi cần sửa)'),
      el('div', { class: 'grid2' },
        el('div', {}, el('label', {}, 'Khoảng nghỉ giữa các đoạn giọng (giây)'), f.gap),
        el('div', {}, el('label', {}, 'Tỉ lệ giọng tối đa (% tổng)'), f.ratio),
        el('div', {}, el('label', {}, 'Nhạc nhỏ dần sau khi giọng hết (giây)'), f.f1),
        el('div', {}, el('label', {}, 'Khoảng lặng (giây)'), f.f2),
        el('div', {}, el('label', {}, 'Nhạc dâng lại (giây)'), f.f3),
        el('div', {}, el('label', {}, 'Fade cuối video (giây)'), f.f4))),
    el('div', { class: 'formsec' }, el('h4', {}, '4. Kho tài nguyên (tick được nhiều kho mỗi loại)'), poolSection),
    el('div', { class: 'formsec' }, el('h4', {}, '5. Xem trước'), previewBox),
    el('div', { class: 'row', style: 'margin-top:14px' },
      el('button', { class: 'btn', onclick: preview }, 'Xem trước'),
      el('button', { class: 'btn primary', onclick: save }, isNew ? 'Tạo playlist' : 'Lưu'),
      el('button', { class: 'btn', onclick: closeModal }, 'Đóng')));
  $('#modal').classList.add('wide');
}
const inp = v => { const i = el('input'); i.value = v ?? ''; return i; };
const sel = (opts, cur) => el('select', {}, opts.map(([v, t]) => { const o = el('option', { value: v }, t); if (v === cur) o.selected = true; return o; }));

// ================= TRANG KHO TÀI NGUYÊN =================
async function pagePools() {
  const pools = await api('GET', '/api/pool');
  const main = el('div', {},
    el('div', { class: 'row' }, el('h2', {}, 'Kho tài nguyên'),
      el('button', { class: 'btn primary', onclick: () => editPoolForm(null) }, '+ Tạo kho mới')),
    el('p', { class: 'mut' }, 'Thêm file: bấm "Tải lên" (từ máy anh) hoặc chép vào thư mục kho rồi bấm "Quét lại". Hook / chuyện / outro THIẾU .srt sẽ bị từ chối. Ẩn = bỏ khỏi sản xuất, file gốc trên đĩa không bị chạm.'));
  const groups = { hook: [], story: [], outro: [], shot: [], music: [] };
  for (const p of pools) (groups[p.kind] ??= []).push(p);
  for (const [kind, list] of Object.entries(groups)) {
    const box = el('div', { class: 'card' }, el('div', { class: 'row' }, el('h3', {}, POOL_NAME[kind] ?? kind),
      el('button', { class: 'btn sm', onclick: () => editPoolForm(null, kind) }, '+ Thêm kho')));
    if (!list.length) { box.append(el('p', { class: 'mut' }, 'Chưa có kho nào.')); main.append(box); continue; }
    const tb = el('table', {},
      el('tr', {}, el('th', {}, 'Kho'), el('th', { class: 'num' }, 'Mục'), el('th', { class: 'num' }, 'Tổng'), el('th', {}, 'Thư mục gốc'), el('th', {}, '')));
    for (const p of list) tb.append(el('tr', {},
      el('td', {}, el('strong', {}, p.name)),
      el('td', { class: 'num' }, String(p.asset_count)),
      el('td', { class: 'num' }, fmtMin(p.total_minutes)),
      el('td', { class: 'mut' }, p.root_dir),
      el('td', {},
        el('button', { class: 'btn sm', onclick: () => viewPool(p) }, 'Mở'),
        ' ',
        el('button', { class: 'btn sm', onclick: () => uploadForm(p) }, 'Tải lên'),
        ' ',
        el('button', { class: 'btn sm', onclick: () => editPoolForm(p) }, 'Sửa kho'),
        ' ',
        el('button', { class: 'btn sm', onclick: async () => showScan(p, await api('POST', `/api/pool/${p.id}/scan`)) }, 'Quét lại'),
        ' ',
        el('button', { class: 'btn sm', onclick: async () => {
          const r = await api('GET', `/api/pool/${p.id}/audit`);
          modal(el('h3', {}, 'Soát kho: ' + p.name),
            el('p', {}, `File mất trên đĩa: ${r.missing.length} (đã cập nhật DB: không bốc nữa · còn dùng được ${r.sync?.active ?? '?'})`),
            ...r.missing.slice(0, 20).map(m => el('p', { class: 'mut' }, m.file_path)),
            el('p', {}, `Trùng md5: ${r.dupes.length} nhóm`),
            el('button', { class: 'btn', onclick: closeModal }, 'Đóng'));
        } }, 'Soát'),
        ' ',
        el('button', { class: 'btn sm', onclick: () => archivePool(p) }, '🗄 Lưu trữ')))); 
    box.append(tb); main.append(box);
  }
  return main;
}
const POOL_NAME = { hook: '🪝 Hook', story: '📖 Chuyện', outro: '🏁 Outro', shot: '🎬 Video shot', music: '🎵 Nhạc nền' };
function showScan(p, r) {
  modal(el('h3', {}, 'Quét lại: ' + p.name),
    el('p', {}, `Thấy ${r.seen} file · thêm mới ${r.added}`),
    r.rejected?.length ? el('div', {},
      el('p', { class: 'badge bad' }, `Từ chối ${r.rejected.length} file thiếu phụ đề .srt:`),
      ...r.rejected.slice(0, 50).map(n => el('p', { class: 'mut' }, n))) : null,
    el('button', { class: 'btn', onclick: () => { closeModal(); nav('pools'); } }, 'Đóng'));
}
function editPoolForm(p, kind) { // p=null → tạo kho mới
  const id = inp(p?.id ?? ''), name = inp(p?.name ?? ''), dir = inp(p?.root_dir ?? '');
  const kindSel = el('select', {}, ...Object.entries(POOL_NAME).map(([k, v]) => el('option', { value: k }, v)));
  kindSel.value = p?.kind ?? kind ?? 'hook';
  if (p) { id.disabled = true; kindSel.disabled = true; }
  modal(el('h3', {}, p ? 'Sửa kho: ' + p.name : 'Tạo kho mới'),
    el('label', {}, 'Mã kho (chữ thường, số, gạch ngang — không đổi được sau khi tạo)'), id,
    el('label', {}, 'Loại'), kindSel,
    el('label', {}, 'Tên hiển thị'), name,
    el('label', {}, 'Đường dẫn thư mục kho (vd D:\\story-library\\hook-moi\\narrations)'), dir,
    el('p', { class: 'mut' }, p ? 'Đổi thư mục: phải chép ĐỦ file của kho sang thư mục mới trước; hệ thống tự chuyển đường dẫn các mục theo. Thiếu file nào sẽ từ chối.' : 'Thư mục chưa có sẽ được tạo.'),
    el('div', { class: 'row', style: 'margin-top:12px' },
      el('button', { class: 'btn primary', onclick: async () => {
        if (p) await api('PUT', '/api/pool/' + p.id, { name: name.value.trim(), root_dir: dir.value.trim() });
        else await api('POST', '/api/pool', { id: id.value.trim(), kind: kindSel.value, name: name.value.trim(), root_dir: dir.value.trim() });
        closeModal(); toast('Đã lưu kho'); nav('pools');
      } }, 'Lưu'),
      el('button', { class: 'btn', onclick: closeModal }, 'Huỷ')));
}
function uploadForm(p) {
  const voice = ['hook', 'story', 'outro'].includes(p.kind);
  const f = el('input', { type: 'file', multiple: 'multiple' });
  const log = el('div', { style: 'max-height:40vh;overflow:auto;margin-top:8px' });
  const go = el('button', { class: 'btn primary', onclick: async () => {
    const files = [...f.files];
    if (!files.length) return toast('Chưa chọn file', true);
    go.disabled = true; let ok = 0;
    for (const [i, file] of files.entries()) {
      const line = el('p', { class: 'mut' }, `(${i + 1}/${files.length}) ${file.name} — đang tải…`); log.append(line);
      try {
        const r = await fetch(`/api/pool/${p.id}/upload`, { method: 'POST', headers: { 'x-filename': encodeURIComponent(file.name) }, body: file });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        line.textContent = `✅ ${file.name}`; ok++;
      } catch (e) { line.textContent = `❌ ${file.name}: ${e.message}`; line.className = 'badge bad'; }
    }
    toast(`Tải xong ${ok}/${files.length} file — đang quét vào kho…`);
    showScan(p, await api('POST', `/api/pool/${p.id}/scan`));
  } }, 'Tải lên');
  modal(el('h3', {}, 'Tải lên kho: ' + p.name),
    el('p', { class: 'mut' }, voice
      ? 'Chọn CẢ file âm thanh (.mp3/.wav) VÀ file phụ đề .srt cùng tên. File nào thiếu .srt sẽ bị từ chối khi quét.'
      : p.kind === 'shot' ? 'Nhận .mp4 / .mov / .webm' : 'Nhận .mp3 / .wav / .flac / .m4a'),
    el('p', { class: 'mut' }, 'Lưu vào: ' + p.root_dir), f, log,
    el('div', { class: 'row', style: 'margin-top:12px' }, go, el('button', { class: 'btn', onclick: closeModal }, 'Đóng')));
}
async function viewPool(pool) {
  const q = el('input', { placeholder: 'Lọc theo tên / thẻ…' });
  const tb = el('table');
  async function load() {
    const assets = await api('GET', `/api/pool/${pool.id}/asset` + (q.value ? '?q=' + encodeURIComponent(q.value) : ''));
    tb.replaceChildren(el('tr', {}, el('th', {}, 'Tên'), el('th', { class: 'num' }, 'Giây'), el('th', { class: 'num' }, 'Đã dùng'), el('th', {}, 'Phụ đề'), el('th', {}, '')));
    for (const a of assets.slice(0, 200)) tb.append(el('tr', {},
      el('td', {}, a.title ?? a.file_path.split(/[\\/]/).pop()),
      el('td', { class: 'num' }, a.duration_s == null ? '—' : String(Math.round(a.duration_s))),
      el('td', { class: 'num' }, String(a.used_total ?? 0)),
      el('td', {}, a.has_subtitle ? '✅' : '—'),
      el('td', {},
        el('button', { class: 'btn sm', onclick: () => editAsset(a, load) }, 'Sửa'),
        ' ',
        el('button', { class: 'btn sm danger', onclick: async () => { await api('DELETE', '/api/asset/' + a.id); toast('Đã ẩn (file gốc còn nguyên)'); load(); } }, 'Ẩn'))));
  }
  q.oninput = () => load();
  await load();
  modal(el('h3', {}, 'Kho: ' + pool.name), q, el('div', { style: 'max-height:60vh;overflow:auto;margin-top:10px' }, tb),
    el('button', { class: 'btn', style: 'margin-top:12px', onclick: closeModal }, 'Đóng'));
}
function editAsset(a, reload) {
  const t = inp(a.title), tags = inp(a.tags ? JSON.parse(a.tags).join(', ') : ''), note = inp(a.note ?? '');
  modal(el('h3', {}, 'Sửa tài nguyên'),
    el('p', { class: 'mut' }, a.file_path),
    el('label', {}, 'Tên'), t, el('label', {}, 'Thẻ (phân cách phẩy)'), tags, el('label', {}, 'Ghi chú'), note,
    el('div', { class: 'row', style: 'margin-top:12px' },
      el('button', { class: 'btn primary', onclick: async () => {
        await api('PUT', '/api/asset/' + a.id, { title: t.value, tags: JSON.stringify(tags.value.split(',').map(s => s.trim()).filter(Boolean)), note: note.value });
        closeModal(); toast('Đã lưu'); reload();
      } }, 'Lưu'),
      el('button', { class: 'btn', onclick: closeModal }, 'Huỷ')));
}

// ================= TRANG KHO CHỮ & SEO =================
async function pageTexts() {
  const chans = await api('GET', '/api/channel');
  const main = el('div', {}, el('h2', {}, 'Kho chữ thumbnail & SEO'));
  const chSel = el('select', {}, chans.map(c => el('option', { value: c.id }, c.name)));
  const poolSel = el('select');
  const tabs = el('div', { class: 'tabs' });
  const body = el('div');
  const KINDS = [['thumb', 'Chữ thumbnail'], ['title', 'Title'], ['description', 'Mô tả'], ['tags', 'Tag']];
  let cur = 'thumb';
  async function loadPools() {
    const pools = await api('GET', `/api/channel/${chSel.value}/textpool`);
    poolSel.replaceChildren(...pools.map(p => el('option', { value: p.id }, p.id)));
    if (pools.length) await loadBody();
    else body.replaceChildren(el('p', { class: 'mut' }, 'Kênh này chưa có kho chữ.'));
  }
  async function loadBody() {
    tabs.replaceChildren(...KINDS.map(([k, t]) => el('button', { class: k === cur ? 'active' : '', onclick: () => { cur = k; loadBody(); } }, t)));
    const pid = poolSel.value;
    if (cur === 'thumb') {
      const items = await api('GET', `/api/textpool/${pid}/thumbnail-text`);
      const tb = el('table', {}, el('tr', {}, el('th', {}, 'Dòng 1'), el('th', {}, 'Dòng 2'), el('th', { class: 'num' }, 'Đã dùng'), el('th', {}, '')));
      for (const it of items) tb.append(el('tr', {},
        el('td', {}, it.line1), el('td', {}, it.line2 ?? ''), el('td', { class: 'num' }, String(it.used_count)),
        el('td', {},
          el('button', { class: 'btn sm', onclick: () => {
            const l1 = inp(it.line1), l2 = inp(it.line2 ?? '');
            modal(el('h3', {}, 'Sửa chữ thumbnail'), el('label', {}, 'Dòng 1'), l1, el('label', {}, 'Dòng 2'), l2,
              el('div', { class: 'row', style: 'margin-top:12px' },
                el('button', { class: 'btn primary', onclick: async () => { await api('PUT', '/api/thumbnail-text/' + it.id, { line1: l1.value, line2: l2.value || null }); closeModal(); loadBody(); } }, 'Lưu'),
                el('button', { class: 'btn', onclick: closeModal }, 'Huỷ')));
          } }, 'Sửa'), ' ',
          el('button', { class: 'btn sm danger', onclick: async () => { await api('DELETE', '/api/thumbnail-text/' + it.id); loadBody(); } }, 'Xoá'))));
      const add = el('button', { class: 'btn', style: 'margin:10px 0', onclick: () => {
        const ta = el('textarea', { rows: 6, placeholder: 'Mỗi dòng: DÒNG 1 | DÒNG 2' });
        modal(el('h3', {}, 'Thêm chữ (dán nhiều dòng)'), ta,
          el('div', { class: 'row', style: 'margin-top:12px' },
            el('button', { class: 'btn primary', onclick: async () => {
              const items = ta.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [a, b] = l.split('|').map(s => s.trim()); return { line1: a, line2: b || null }; });
              await api('POST', `/api/textpool/${pid}/thumbnail-text`, { items });
              closeModal(); toast('Đã thêm ' + items.length); loadBody();
            } }, 'Thêm'),
            el('button', { class: 'btn', onclick: closeModal }, 'Huỷ')));
      } }, '+ Thêm chữ');
      body.replaceChildren(add, el('div', { style: 'max-height:56vh;overflow:auto' }, tb));
    } else {
      const items = await api('GET', `/api/textpool/${pid}/seo?kind=${cur}`);
      const tb = el('table', {}, el('tr', {}, el('th', {}, 'Nội dung'), el('th', { class: 'num' }, 'Đã dùng'), el('th', {}, '')));
      for (const it of items.slice(0, 300)) tb.append(el('tr', {},
        el('td', {}, it.content.length > 130 ? it.content.slice(0, 130) + '…' : it.content),
        el('td', { class: 'num' }, String(it.used_count)),
        el('td', {}, el('button', { class: 'btn sm danger', onclick: async () => { await api('DELETE', '/api/seo/' + it.id); loadBody(); } }, 'Xoá'))));
      const add = el('button', { class: 'btn', style: 'margin:10px 0', onclick: () => {
        const ta = el('textarea', { rows: 6, placeholder: 'Mỗi dòng một mục' });
        modal(el('h3', {}, 'Thêm ' + cur), ta,
          el('div', { class: 'row', style: 'margin-top:12px' },
            el('button', { class: 'btn primary', onclick: async () => {
              const items = ta.value.split('\n').map(l => l.trim()).filter(Boolean).map(content => ({ kind: cur, content }));
              await api('POST', `/api/textpool/${pid}/seo`, { items });
              closeModal(); toast('Đã thêm ' + items.length); loadBody();
            } }, 'Thêm'),
            el('button', { class: 'btn', onclick: closeModal }, 'Huỷ')));
      } }, '+ Thêm');
      body.replaceChildren(add, el('div', { style: 'max-height:56vh;overflow:auto' }, tb));
    }
  }
  chSel.onchange = loadPools; poolSel.onchange = loadBody;
  main.append(el('div', { class: 'card row' }, el('span', {}, 'Kênh:'), chSel, el('span', {}, 'Kho:'), poolSel), tabs, body);
  await loadPools();
  return main;
}

// ================= TRANG SẢN XUẤT =================
async function pageJobs() {
  const chans = await api('GET', '/api/channel');
  const allPl = (await Promise.all(chans.map(c => api('GET', `/api/channel/${c.id}/playlist`)))).flat();
  const plSel = el('select', {}, allPl.filter(p => p.enabled).map(p => el('option', { value: p.id }, p.name)));
  const planBox = el('div');
  const main = el('div', {}, el('h2', {}, 'Sản xuất'),
    el('div', { class: 'card row' },
      el('span', {}, 'Playlist:'), plSel,
      el('button', { class: 'btn primary', onclick: async () => {
        planBox.replaceChildren(el('p', { class: 'mut' }, 'Đang lập kế hoạch…'));
        const r = await api('POST', `/api/playlist/${plSel.value}/plan`, {});
        if (!r.ok) {
          planBox.replaceChildren(el('div', { class: 'card' },
            el('h3', {}, '⛔ Không đủ điều kiện'),
            ...[...(r.gate?.errors ?? []), ...(r.sys?.errors ?? []), ...(r.errors ?? [])].map(e => el('p', { class: 'badge bad' }, e))));
          return;
        }
        const pl = r.plan;
        planBox.replaceChildren(el('div', { class: 'card' },
          el('h3', {}, `Kế hoạch (seed ${r.seed}) — DUYỆT rồi mới chạy`),
          el('p', {}, `Tổng: ${(pl.total_s / 60).toFixed(1)} phút · giọng đọc tới ${(pl.voice_end_s / 60).toFixed(1)} phút (${Math.round(pl.voice_ratio * 100)}%) · đuôi ${(pl.tail_len_s / 60).toFixed(1)} phút`),
          el('p', {}, `Fade: ra ${pl.fades.out_of_body?.dur_s ?? '—'}s · lặng ${pl.fades.silence?.dur_s ?? '—'}s · vào ${pl.fades.into_tail?.dur_s ?? '—'}s · cuối ${pl.fades.end_fade.dur_s}s`),
          ...(r.warnings ?? []).map(w => el('p', { class: 'badge warn' }, w)),
          el('table', {},
            el('tr', {}, el('th', {}, 'Đoạn'), el('th', {}, 'Từ'), el('th', {}, 'Đến'), el('th', {}, 'Nguồn')),
            ...pl.timeline.map(s => el('tr', {},
              el('td', {}, s.kind), el('td', {}, sec2str(s.start_s)), el('td', {}, sec2str(s.end_s)),
              el('td', { class: 'mut' }, s.source?.title ?? '')))),
          el('button', { class: 'btn primary', style: 'margin-top:12px', onclick: async () => {
            await api('POST', '/api/job', { playlist_id: plSel.value, plan: pl });
            toast('Đã xếp hàng — bộ giám sát chạy khi tới lượt (một kênh một lúc)'); nav('chain');
          } }, '▶ Xếp hàng sản xuất')));
      } }, 'Lập kế hoạch')),
    planBox, el('h3', {}, 'Hàng đợi'));
  const jobs = await api('GET', '/api/job');
  const tb = el('table', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Playlist'), el('th', {}, 'Trạng thái'), el('th', {}, 'Tạo lúc'), el('th', {}, 'Video / lỗi')));
  for (const j of jobs) tb.append(el('tr', {},
    el('td', {}, String(j.id)), el('td', {}, j.playlist_id),
    el('td', {}, el('span', { class: 'badge ' + (j.status === 'done' ? 'good' : j.status === 'failed' ? 'bad' : 'warn') }, j.status)),
    el('td', { class: 'mut' }, j.created_at ?? ''),
    el('td', { class: 'mut' }, j.error ?? j.video_path ?? '')));
  main.append(el('div', { class: 'card' }, jobs.length ? tb : el('p', { class: 'mut' }, 'Chưa có job nào.')));
  return main;
}
const sec2str = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = Math.floor(s % 60); return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); };

// ================= điều hướng =================
// ================= TRANG CHẠY CHUỖI (B3) =================
const ST_VN = { pending: 'Chờ', running: 'Đang chạy', done: 'Xong', failed: 'Lỗi', cancelled: 'Đã huỷ', queued: 'Xếp hàng', paused: 'Tạm dừng' };
const ST_CLS = { done: 'good', failed: 'bad', cancelled: 'bad', running: 'info', paused: 'warn', queued: 'warn', pending: '' };
let chainTimer = null;
async function pageChain() {
  const chans = await api('GET', '/api/channel');
  const pls = (await Promise.all(chans.map(async c => (await api('GET', `/api/channel/${c.id}/playlist`)).map(p => ({ ...p, ch: c.name }))))).flat().filter(p => p.enabled);
  const now = await api('GET', '/api/now');
  // --- chọn + sắp thứ tự ---
  const order = [];
  const listBox = el('div', { class: 'orderlist' });
  const redraw = () => listBox.replaceChildren(...(order.length ? order.map((id, i) => {
    const p = pls.find(x => x.id === id);
    return el('div', { class: 'orderrow', draggable: 'true', 'data-i': i },
      el('span', { class: 'mut' }, (i + 1) + '.'), el('strong', { class: 'grow' }, p.name), el('span', { class: 'mut' }, p.ch),
      el('button', { class: 'btn sm', onclick: () => { if (i) { [order[i - 1], order[i]] = [order[i], order[i - 1]]; redraw(); } } }, '↑'),
      el('button', { class: 'btn sm', onclick: () => { if (i < order.length - 1) { [order[i + 1], order[i]] = [order[i], order[i + 1]]; redraw(); } } }, '↓'),
      el('button', { class: 'btn sm danger', onclick: () => { order.splice(i, 1); sync(); } }, '✕'));
  }) : [el('p', { class: 'mut' }, 'Chưa chọn playlist nào — tick ở danh sách bên trái.')]));
  const boxes = {};
  const sync = () => { for (const [id, c] of Object.entries(boxes)) c.checked = order.includes(id); redraw(); };
  const pick = el('div', {}, pls.map(p => { const c = el('input', { type: 'checkbox' }); boxes[p.id] = c;
    c.onchange = () => { if (c.checked) order.push(p.id); else order.splice(order.indexOf(p.id), 1); redraw(); };
    return el('label', { class: 'ck' }, c, el('span', { class: 'grow' }, p.name), el('span', { class: 'mut' }, p.ch)); }));
  redraw();
  const nameIn = inp(''); nameIn.placeholder = 'Tên chuỗi (tuỳ chọn)';
  const timeIn = el('input', { type: 'time' }); timeIn.value = '22:00';
  const runNow = el('button', { class: 'btn primary', onclick: async () => {
    if (!order.length) return toast('Chưa chọn playlist', true);
    if (!confirm(`Chạy ngay chuỗi ${order.length} kênh?\nMỗi kênh: dựng → upload (Riêng tư) → dọn → kênh kế.`)) return;
    await api('POST', '/api/chain', { name: nameIn.value.trim() || null, playlist_ids: order }); toast('Đã tạo chuỗi'); nav('chain');
  } }, '▶ Chạy ngay');
  const saveSch = el('button', { class: 'btn', onclick: async () => {
    if (!order.length) return toast('Chưa chọn playlist', true);
    await api('POST', '/api/schedule', { name: nameIn.value.trim() || null, time_vn: timeIn.value, playlist_ids: order });
    toast('Đã lưu lịch ' + timeIn.value + ' (giờ VN) mỗi ngày'); nav('chain');
  } }, '⏰ Lưu thành lịch mỗi ngày');

  // --- lịch đã có ---
  const sch = await api('GET', '/api/schedule');
  const plName = id => pls.find(p => p.id === id)?.name ?? id;
  const schBox = el('div', {}, sch.length ? sch.map(x => el('div', { class: 'tree-pl' },
    el('strong', {}, x.time_vn), el('span', { class: 'grow' }, `${x.name} — ${x.playlist_ids.map(plName).join(' → ')}`),
    el('span', { class: 'badge ' + (x.enabled ? 'good' : '') }, x.enabled ? 'Bật' : 'Tắt'),
    el('button', { class: 'btn sm', onclick: async () => { await api('PUT', '/api/schedule/' + x.id, { ...x, enabled: !x.enabled }); nav('chain'); } }, x.enabled ? 'Tắt' : 'Bật'),
    el('button', { class: 'btn sm danger', onclick: async () => { if (confirm('Xoá lịch ' + x.time_vn + '?')) { await api('DELETE', '/api/schedule/' + x.id); nav('chain'); } } }, 'Xoá')))
    : [el('p', { class: 'mut' }, 'Chưa có lịch hẹn.')]);

  // --- các chuỗi ---
  const chainsBox = el('div');
  async function drawChains() {
    const chains = await api('GET', '/api/chain');
    chainsBox.replaceChildren(...(chains.length ? chains.map(c => {
      const done = c.items.filter(i => ['done', 'failed', 'cancelled'].includes(i.status)).length;
      const pct = c.items.length ? Math.round(done / c.items.length * 100) : 0;
      const ctl = [];
      if (['running', 'queued'].includes(c.status)) ctl.push(el('button', { class: 'btn sm', onclick: async () => { await api('POST', `/api/chain/${c.id}/pause`); drawChains(); } }, '⏸ Tạm dừng'));
      if (c.status === 'paused') ctl.push(el('button', { class: 'btn sm primary', onclick: async () => { await api('POST', `/api/chain/${c.id}/resume`); drawChains(); } }, '▶ Chạy tiếp'));
      if (!['done', 'cancelled'].includes(c.status)) ctl.push(el('button', { class: 'btn sm danger', onclick: async () => { if (confirm('Huỷ chuỗi? Kênh đang chạy sẽ bị dừng và dọn file tạm.')) { await api('POST', `/api/chain/${c.id}/cancel`); drawChains(); } } }, '⏹ Huỷ'));
      if (c.log_name) ctl.push(el('button', { class: 'btn sm', onclick: () => showLog(c.log_name) }, 'Nhật ký chuỗi'));
      return el('div', { class: 'card' },
        el('div', { class: 'row' }, el('strong', {}, `#${c.id} ${c.name}`), el('span', { class: 'badge ' + (ST_CLS[c.status] ?? '') }, ST_VN[c.status] ?? c.status),
          el('span', { class: 'mut' }, c.source === 'schedule' ? 'theo lịch' : 'bấm tay'), el('span', { class: 'grow' }), ...ctl),
        el('div', { class: 'progress' }, el('span', { style: `width:${pct}%` })),
        el('p', { class: 'mut' }, `${done}/${c.items.length} kênh · tạo ${c.created_vn}${c.finished_vn ? ' · kết thúc ' + c.finished_vn : ''}`),
        el('table', { class: 'tbl' }, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Playlist'), el('th', {}, 'Trạng thái'), el('th', {}, 'Bước'), el('th', {}, 'Kết quả'), el('th', {}, '')),
          c.items.map(i => el('tr', {}, el('td', {}, String(i.position)), el('td', {}, i.name),
            el('td', {}, el('span', { class: 'badge ' + (ST_CLS[i.status] ?? '') }, ST_VN[i.status] ?? i.status)),
            el('td', { class: 'mut' }, (i.stage ?? '') + (i.status === 'running' && i.last_progress_vn ? ' · tiến độ lúc ' + i.last_progress_vn.slice(11) : '')),
            el('td', {}, i.youtube_video_id ? el('a', { href: 'https://youtu.be/' + i.youtube_video_id, target: '_blank' }, 'youtu.be/' + i.youtube_video_id) : el('span', { class: 'mut' }, i.error ?? '')),
            el('td', {}, i.log_name ? el('button', { class: 'btn sm', onclick: () => showLog(i.log_name) }, 'Log') : '')))));
    }) : [el('p', { class: 'mut' }, 'Chưa có chuỗi nào.')]));
  }
  await drawChains();
  clearInterval(chainTimer);
  chainTimer = setInterval(() => { if (document.querySelector('#nav button.active')?.dataset.page === 'chain') drawChains(); else clearInterval(chainTimer); }, 10000);

  return el('div', {},
    el('h2', {}, 'Chạy chuỗi nhiều playlist'),
    el('p', { class: 'mut' }, `Giờ Việt Nam hiện tại: ${now.vn}. Mỗi lúc chỉ MỘT kênh chạy; kênh xong (thành công hay lỗi) và dọn xong file tạm thì chạy ngay kênh kế. Treo 10 phút không tiến độ → dừng, ghi log, dọn, sang kênh kế.`),
    el('div', { class: 'grid2' },
      el('div', { class: 'card' }, el('h3', {}, '1. Chọn playlist'), pick),
      el('div', { class: 'card' }, el('h3', {}, '2. Thứ tự chạy'), listBox, nameIn,
        el('div', { class: 'row', style: 'margin-top:10px' }, runNow),
        el('div', { class: 'row', style: 'margin-top:10px' }, el('span', {}, 'Giờ hẹn (VN):'), timeIn, saveSch))),
    el('div', { class: 'card' }, el('h3', {}, 'Lịch hẹn mỗi ngày (giờ Việt Nam)'), schBox),
    el('h3', {}, 'Các chuỗi gần đây (tự làm mới mỗi 10 giây)'), chainsBox);
}

// ================= TRANG NHẬT KÝ (B3) =================
async function showLog(name) {
  const r = await api('GET', '/api/logs/' + encodeURIComponent(name));
  const pre = el('pre', { class: 'logview' }, r.text);
  modal(el('h3', {}, name),
    el('div', { class: 'row' }, el('a', { class: 'btn sm', href: '/api/logs/' + encodeURIComponent(name) + '/download' }, 'Tải về'),
      el('button', { class: 'btn sm', onclick: closeModal }, 'Đóng')), pre);
  $('#modal').classList.add('wide');
  pre.scrollTop = pre.scrollHeight;
}
async function pageLogs() {
  const logs = await api('GET', '/api/logs');
  const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  return el('div', {}, el('h2', {}, 'Nhật ký'),
    el('p', { class: 'mut' }, 'File text ghi lại từng chuỗi (chuoi-*.log) và từng video (job-*.log). Giờ Việt Nam. Tự xoá sau 30 ngày.'),
    el('div', { class: 'card' }, logs.length ? el('table', { class: 'tbl' },
      el('tr', {}, el('th', {}, 'Tên'), el('th', {}, 'Sửa lần cuối (VN)'), el('th', {}, 'Dung lượng'), el('th', {}, '')),
      logs.map(l => el('tr', {}, el('td', {}, l.name), el('td', { class: 'mut' }, l.mtime_vn), el('td', { class: 'mut' }, kb(l.size)),
        el('td', {}, el('button', { class: 'btn sm', onclick: () => showLog(l.name) }, 'Xem'), ' ',
          el('a', { class: 'btn sm', href: '/api/logs/' + encodeURIComponent(l.name) + '/download' }, 'Tải về')))))
      : el('p', { class: 'mut' }, 'Chưa có nhật ký nào.')));
}

// ================= TRANG LƯU TRỮ (30/09) =================
async function pageArchive() {
  const r = await api('GET', '/api/archive');
  const restore = (url, msg) => async () => { await api('POST', url); toast(msg); nav('archive'); };
  const tbl = (head, rows) => rows.length ? el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('tr', {}, ...head.map(h => el('th', {}, h))), rows))
    : el('p', { class: 'mut' }, 'Không có mục nào.');
  const kindVN = { hook: 'Hook', story: 'Chuyện', outro: 'Outro', shot: 'Video shot', music: 'Nhạc nền' };
  return el('div', {}, el('h2', {}, '🗄 Lưu trữ'),
    el('p', { class: 'mut' }, 'Các mục đã lưu trữ/ẩn không bị xoá — bấm Khôi phục để dùng lại. File trên ổ luôn giữ nguyên.'),
    el('div', { class: 'card' }, el('h3', {}, `Kênh (${r.channels.length})`),
      tbl(['Kênh', 'Playlist đi kèm', 'Lưu trữ lúc', ''], r.channels.map(c => el('tr', {}, el('td', {}, c.name), el('td', { class: 'num' }, String(c.playlist_count)),
        el('td', { class: 'mut' }, c.archived_at ?? ''), el('td', {}, el('button', { class: 'btn sm primary', onclick: restore(`/api/channel/${c.id}/restore`, 'Đã khôi phục kênh ' + c.name) }, '♻ Khôi phục')))))),
    el('div', { class: 'card' }, el('h3', {}, `Playlist (${r.playlists.length})`),
      tbl(['Playlist', 'Kênh', 'Lưu trữ lúc', ''], r.playlists.map(p => el('tr', {}, el('td', {}, p.name), el('td', {}, p.channel_name + (p.channel_archived ? ' (kênh đang lưu trữ)' : '')),
        el('td', { class: 'mut' }, p.archived_at ?? ''), el('td', {}, el('button', { class: 'btn sm primary', onclick: restore(`/api/playlist/${p.id}/restore`, 'Đã khôi phục playlist ' + p.name) }, '♻ Khôi phục')))))),
    el('div', { class: 'card' }, el('h3', {}, `Kho (${r.pools.length})`),
      tbl(['Kho', 'Loại', 'Số mục', 'Thư mục', ''], r.pools.map(p => el('tr', {}, el('td', {}, p.name), el('td', {}, kindVN[p.kind] ?? p.kind), el('td', { class: 'num' }, String(p.asset_count)),
        el('td', { class: 'mut' }, p.root_dir), el('td', {}, el('button', { class: 'btn sm primary', onclick: restore(`/api/pool/${p.id}/restore`, 'Đã khôi phục kho ' + p.name) }, '♻ Khôi phục')))))),
    el('div', { class: 'card' }, el('h3', {}, `Mục đã ẩn trong kho (${r.assets.length})`),
      tbl(['Tên', 'Kho', 'Loại', ''], r.assets.map(a => el('tr', {}, el('td', {}, a.title ?? a.file_path), el('td', {}, a.pool_name), el('td', {}, kindVN[a.kind] ?? a.kind),
        el('td', {}, el('button', { class: 'btn sm primary', onclick: restore(`/api/asset/${a.id}/restore`, 'Đã khôi phục ' + (a.title ?? '')) }, '♻ Khôi phục')))))));
}

const PAGES = { channels: pageChannels, pools: pagePools, texts: pageTexts, jobs: pageJobs, chain: pageChain, logs: pageLogs, archive: pageArchive };
async function nav(page) {
  document.querySelectorAll('#nav button[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $('#main').replaceChildren(el('p', { class: 'mut' }, 'Đang tải…'));
  try { $('#main').replaceChildren(await PAGES[page]()); }
  catch (e) { $('#main').replaceChildren(el('p', { class: 'badge bad' }, 'Lỗi: ' + e.message)); }
}
document.querySelectorAll('#nav button[data-page]').forEach(b => b.onclick = () => nav(b.dataset.page));
api('GET', '/api/system').then(s => {
  $('#sysinfo').textContent = `Đĩa C: còn ${s.disk_free_gb} GB · ${s.db_counts.asset} tài nguyên · ${s.db_counts.job} job`;
});
nav('channels');
document.querySelectorAll('#nav button[data-page]').forEach(b => b.onclick = () => nav(b.dataset.page));
api('GET', '/api/system').then(s => {
  $('#sysinfo').textContent = `Đĩa C: còn ${s.disk_free_gb} GB · ${s.db_counts.asset} tài nguyên · ${s.db_counts.job} job`;
});
nav('channels');
