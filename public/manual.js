// manual.js - trang "🎬 Video ghép tay" (11/2026): chọn giọng (cây thư mục) + thư mục ảnh + kiểu phụ đề + metadata → dựng / đăng.
// Dùng el/api/toast/modal/sel/nav/PAGES của app.js.
(() => {
  const MJ_ST = { queued: 'Xếp hàng', rendering: 'Đang dựng', uploading: 'Đang đăng', done: 'Xong', failed: 'Lỗi', cancelled: 'Đã huỷ' };
  const MJ_CLS = { done: 'good', failed: 'bad', cancelled: 'bad', rendering: 'info', uploading: 'info', queued: 'warn' };
  const FONTS = ['Arial', 'Tahoma', 'Times New Roman', 'Segoe UI', 'Verdana', 'MS Song'];
  const fmt = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); };
  let jobTimer = null;
  const lbl = (t, ...kids) => el('label', { style: 'display:inline-flex;gap:6px;align-items:center;margin:4px 12px 4px 0' }, t, ...kids);
  const num = (v, attrs = {}) => { const i = el('input', { type: 'number', style: 'width:80px', ...attrs }); i.value = v; return i; };
  const color = v => { const i = el('input', { type: 'color' }); i.value = v; return i; };

  async function pageManual() {
    const [chans, pools, presets] = await Promise.all([api('GET', '/api/channel'), api('GET', '/api/pool'), api('GET', '/api/manual/presets')]);
    const voicePools = pools.filter(p => p.kind === 'voice'), imagePools = pools.filter(p => p.kind === 'image');
    const chSel = sel(chans.map(c => [c.id, c.name]));
    // ---------- giọng ----------
    const picked = []; // [{id,name,duration_s,has_subtitle}]
    const vpSel = sel([['', '— chọn kho voice —'], ...voicePools.map(p => [p.id, `${p.name} (${p.asset_count} file)`])]);
    const vTree = el('div', { class: 'mtree', style: 'max-height:360px;overflow:auto' });
    const pickedBox = el('div');
    const gapIn = num(0.5, { step: '0.1', min: '0', max: '10' });
    const drawPicked = () => {
      const total = picked.reduce((s, f) => s + (f.duration_s || 0), 0) + Math.max(0, picked.length - 1) * (Number(gapIn.value) || 0);
      pickedBox.replaceChildren(el('h4', {}, `Đã chọn: ${picked.length} file · tổng ≈ ${fmt(total)}`),
        picked.length ? el('ol', {}, picked.map((f, i) => el('li', {},
          `${f.name} (${fmt(f.duration_s)}) `, f.has_subtitle ? '' : el('span', { class: 'badge bad' }, 'thiếu .srt'), ' ',
          el('button', { class: 'btn sm', onclick: () => { if (i) { [picked[i - 1], picked[i]] = [picked[i], picked[i - 1]]; drawPicked(); } } }, '↑'),
          el('button', { class: 'btn sm', onclick: () => { if (i < picked.length - 1) { [picked[i + 1], picked[i]] = [picked[i], picked[i + 1]]; drawPicked(); } } }, '↓'),
          el('button', { class: 'btn sm danger', onclick: () => { picked.splice(i, 1); drawPicked(); syncChecks(); } }, '✕')))) : el('p', { class: 'mut' }, 'Chưa chọn file giọng nào.'));
    };
    gapIn.oninput = drawPicked;
    const checks = new Map();
    const syncChecks = () => { for (const [id, c] of checks) c.checked = picked.some(f => f.id === id); };
    const voiceNode = (n, depth) => {
      const kids = el('div', { style: 'margin-left:16px' + (depth ? ';display:none' : '') });
      for (const c of n.children) kids.append(voiceNode(c, depth + 1));
      for (const f of n.files) {
        const cb = el('input', { type: 'checkbox' }); checks.set(f.id, cb);
        cb.checked = picked.some(x => x.id === f.id);
        cb.onchange = () => { const i = picked.findIndex(x => x.id === f.id); if (cb.checked && i < 0) picked.push(f); if (!cb.checked && i >= 0) picked.splice(i, 1); drawPicked(); };
        kids.append(el('label', { style: 'display:block' }, cb, ` 🎙 ${f.name} `, el('span', { class: 'mut' }, fmt(f.duration_s)), f.has_subtitle ? '' : el('span', { class: 'badge bad', style: 'margin-left:6px' }, 'thiếu .srt')));
      }
      if (!depth) return kids;
      const head = el('div', { style: 'cursor:pointer;font-weight:600' }, `▸ 📁 ${n.name} `, el('span', { class: 'mut' }, `(${fmt(n.durationTotal_s)})`));
      head.onclick = () => { const open = kids.style.display === 'none'; kids.style.display = open ? '' : 'none'; head.firstChild.textContent = (open ? '▾' : '▸') + ` 📁 ${n.name} `; };
      return el('div', {}, head, kids);
    };
    vpSel.onchange = async () => {
      checks.clear(); if (!vpSel.value) return vTree.replaceChildren();
      vTree.replaceChildren(el('p', { class: 'mut' }, 'Đang tải…'));
      const r = await api('GET', `/api/pool/${vpSel.value}/tree`);
      const root = voiceNode(r.tree, 0); root.style.marginLeft = '0';
      vTree.replaceChildren(root);
    };
    // ---------- ảnh ----------
    const ipSel = sel([['', '— chọn kho ảnh —'], ...imagePools.map(p => [p.id, `${p.name} (${p.asset_count} ảnh)`])]);
    const iTree = el('div', { style: 'max-height:260px;overflow:auto' });
    let imgFolder = null; const folderLbl = el('b', {}, '(chưa chọn)');
    const imgNode = (n, depth) => {
      const row = el('div', { style: `margin-left:${depth * 16}px;cursor:pointer;padding:2px 4px;border-radius:4px` }, `📁 ${n.path ? n.name : '(cả kho)'} `, el('span', { class: 'mut' }, `${n.imageCount} ảnh`));
      row.onclick = () => { iTree.querySelectorAll('div[data-sel]').forEach(d => { d.style.background = ''; d.removeAttribute('data-sel'); });
        row.style.background = '#2a6'; row.dataset.sel = '1'; imgFolder = n.path; folderLbl.textContent = `${n.path || '(cả kho)'} · ${n.imageCount} ảnh`; };
      return [row, ...n.children.flatMap(c => imgNode(c, depth + 1))];
    };
    ipSel.onchange = async () => { imgFolder = null; folderLbl.textContent = '(chưa chọn)'; if (!ipSel.value) return iTree.replaceChildren();
      const r = await api('GET', `/api/pool/${ipSel.value}/tree`); iTree.replaceChildren(...imgNode(r.tree, 0)); };
    const secIn = num(8, { min: '2', max: '60' });
    const orderSel = sel([['shuffle', 'Ngẫu nhiên'], ['sorted', 'Theo tên']]);
    // ---------- khung ----------
    const aspSel = sel([['horizontal', 'Ngang 16:9'], ['vertical', 'Dọc 9:16'], ['square', 'Vuông 1:1']]);
    const qSel = sel([['1080', '1080p'], ['720', '720p (nhanh hơn)']]);
    // ---------- phụ đề ----------
    const S = { font: sel(FONTS.map(f => [f, f]), 'Arial'), size: num(80, { min: '10', max: '220' }), color: color('#FFFFFF'), outlineColor: color('#000000'),
      outline: num(3, { min: '0', max: '20', step: '0.5' }), box: el('input', { type: 'checkbox' }), boxOpacity: num(0.5, { min: '0', max: '1', step: '0.05' }),
      position: sel([['bottom', 'Dưới'], ['middle', 'Giữa'], ['top', 'Trên']]), marginV: num(120, { min: '0', max: '1000' }), bold: el('input', { type: 'checkbox' }) };
    const getStyle = () => ({ font: S.font.value, size: Number(S.size.value), color: S.color.value.toUpperCase(), outlineColor: S.outlineColor.value.toUpperCase(),
      outline: Number(S.outline.value), box: S.box.checked, boxOpacity: Number(S.boxOpacity.value), position: S.position.value, marginV: Number(S.marginV.value), bold: S.bold.checked });
    const setStyle = st => { for (const k of Object.keys(S)) if (st[k] != null) { if (S[k].type === 'checkbox') S[k].checked = !!st[k]; else S[k].value = st[k]; } };
    const presetSel = sel([['', '— mẫu đã lưu —'], ...presets.presets.map(p => [p.id, p.name])]);
    presetSel.onchange = () => { const p = presets.presets.find(x => x.id === presetSel.value); if (p) setStyle(p.style); };
    const savePreset = async () => {
      const cur = presets.presets.find(x => x.id === presetSel.value);
      const name = prompt('Tên mẫu phụ đề:', cur?.name ?? ''); if (!name) return;
      const rec = await api('POST', '/api/manual/presets', { id: cur && cur.name === name ? cur.id : undefined, name, style: getStyle() });
      const i = presets.presets.findIndex(x => x.id === rec.id); if (i >= 0) presets.presets[i] = rec; else { presets.presets.push(rec); presetSel.append(el('option', { value: rec.id }, rec.name)); }
      presetSel.value = rec.id; toast('Đã lưu mẫu ' + name);
    };
    const pvImg = el('img', { style: 'max-width:100%;max-height:480px;display:none;margin-top:8px;border:1px solid #444' });
    const preview = async () => {
      let sampleText = '';
      if (picked[0]) try { sampleText = (await api('GET', '/api/manual/srt-sample/' + picked[0].id)).text; } catch {}
      pvImg.style.display = 'none';
      const r = await api('POST', '/api/manual/preview-frame', { style: getStyle(), aspect: aspSel.value, quality: qSel.value, imagePoolId: ipSel.value || null, imageFolder: imgFolder ?? '', sampleText: sampleText || undefined });
      pvImg.src = r.dataUrl; pvImg.style.display = '';
    };
    // ---------- metadata ----------
    const title = el('input', { style: 'width:100%', maxlength: '100' }), desc = el('textarea', { rows: '5', style: 'width:100%' }), tags = el('input', { style: 'width:100%', placeholder: 'tag1, tag2, ...' });
    const ytPl = el('input', { placeholder: 'PL... (không bắt buộc)', style: 'width:260px' });
    const privSel = sel([['private', 'Riêng tư'], ['unlisted', 'Không công khai'], ['public', 'Công khai']]);
    const pubAt = el('input', { type: 'datetime-local' });
    const capLang = el('input', { style: 'width:60px' }); capLang.value = 'vi';
    const metaOf = () => ({ title: title.value.trim(), description: desc.value, tags: tags.value.split(',').map(s => s.trim()).filter(Boolean),
      youtubePlaylist: ytPl.value.trim() || null, privacy: privSel.value, publishAt: pubAt.value ? new Date(pubAt.value).toISOString() : null });
    const submit = async upload => {
      if (!picked.length) return toast('Chọn ít nhất 1 file giọng', true);
      if (!ipSel.value || imgFolder == null) return toast('Chọn kho ảnh và bấm chọn 1 thư mục ảnh', true);
      if (upload && !title.value.trim()) return toast('Đăng YouTube cần tiêu đề', true);
      if (picked.some(f => !f.has_subtitle) && !confirm('Có file giọng thiếu .srt (đoạn đó sẽ không có phụ đề). Vẫn dựng?')) return;
      if (upload && !confirm('Dựng xong sẽ TỰ ĐĂNG lên kênh ' + chSel.selectedOptions[0].textContent + '. Tiếp tục?')) return;
      const r = await api('POST', '/api/manual-job', { channelId: chSel.value, voiceIds: picked.map(f => f.id), gap: Number(gapIn.value), imagePoolId: ipSel.value, imageFolder: imgFolder,
        secPerImage: Number(secIn.value), order: orderSel.value, aspect: aspSel.value, quality: qSel.value, subStyle: getStyle(), captionLang: capLang.value.trim() || 'vi', autoUpload: upload, meta: metaOf() });
      toast(`Đã xếp hàng job #${r.jobId}`); drawJobs();
    };
    // ---------- danh sách job ----------
    const jobsBox = el('div');
    async function drawJobs() {
      let jobs; try { jobs = await (await fetch('/api/manual-job', { cache: 'no-store' })).json(); } catch { return; }
      jobsBox.replaceChildren(...(jobs.length ? jobs.slice(0, 20).map(jobCard) : [el('p', { class: 'mut' }, 'Chưa có video ghép tay nào.')]));
    }
    const jobCard = j => {
      const m = j.meta || {}, st = j.status;
      const t0 = j.chain_item && j.created_at ? Date.parse(j.created_at.replace(' ', 'T') + 'Z') : null;
      const elapsed = (st === 'rendering' || st === 'queued' || st === 'uploading') && t0 ? ` · ${fmt((Date.now() - t0) / 1000)}` : (j.result?.render_s ? ` · dựng ${fmt(j.result.render_s)}` : '');
      const card = el('div', { class: 'card' },
        el('div', { class: 'row' }, el('b', {}, `#${j.id} ${m.meta?.title || '(chưa có tiêu đề)'}`), ' ',
          el('span', { class: 'badge ' + (MJ_CLS[st] ?? '') }, MJ_ST[st] ?? st),
          el('span', { class: 'mut' }, ` ${m.aspect ?? ''} ${m.quality ?? '1080'}p · ${m.voiceIds?.length ?? 0} giọng${j.chain_item?.stage ? ' · ' + j.chain_item.stage : ''}${elapsed}`)),
        j.error || j.chain_item?.error ? el('p', { class: 'badge bad' }, j.error || j.chain_item.error) : null,
        j.youtube_video_id ? el('p', {}, 'YouTube: ', el('a', { href: 'https://youtu.be/' + j.youtube_video_id, target: '_blank' }, 'https://youtu.be/' + j.youtube_video_id)) : null);
      if (j.video_url) {
        const v = el('video', { controls: '', preload: 'none', poster: `/api/manual-job/${j.id}/thumb`, style: 'max-width:480px;max-height:360px;display:block;margin-top:6px' });
        v.src = j.video_url; card.append(v);
      }
      if (st === 'done' && j.video_url && !j.youtube_video_id) card.append(el('button', { class: 'btn primary', style: 'margin-top:6px', onclick: async () => {
        if (!m.meta?.title) return toast('Job này chưa có tiêu đề - không đăng được', true);
        if (!confirm(`Đăng job #${j.id} "${m.meta.title}" lên YouTube (${m.meta.privacy})?`)) return;
        await api('POST', `/api/manual-job/${j.id}/upload`, {}); toast('Đang đăng…'); drawJobs(); } }, '⬆ Đăng lên YouTube'));
      return card;
    };
    clearInterval(jobTimer);
    jobTimer = setInterval(() => { if (document.querySelector('#nav button.active')?.dataset.page === 'manual') drawJobs(); else clearInterval(jobTimer); }, 8000);
    drawJobs(); drawPicked();
    return el('div', {}, el('h2', {}, '🎬 Video ghép tay'),
      el('div', { class: 'card' }, el('h3', {}, '1. Kênh & giọng đọc'), lbl('Kênh:', chSel), lbl('Kho voice:', vpSel), lbl('Khoảng lặng giữa file (giây):', gapIn),
        el('div', { style: 'display:flex;gap:16px;flex-wrap:wrap' }, el('div', { style: 'flex:1;min-width:300px' }, vTree), el('div', { style: 'flex:1;min-width:300px' }, pickedBox))),
      el('div', { class: 'card' }, el('h3', {}, '2. Ảnh nền'), lbl('Kho ảnh:', ipSel), lbl('Giây/ảnh:', secIn), lbl('Thứ tự:', orderSel),
        el('p', {}, 'Thư mục: ', folderLbl), iTree),
      el('div', { class: 'card' }, el('h3', {}, '3. Khung hình'), lbl('Khung:', aspSel), lbl('Chất lượng:', qSel)),
      el('div', { class: 'card' }, el('h3', {}, '4. Phụ đề'),
        el('div', {}, lbl('Mẫu:', presetSel), el('button', { class: 'btn sm', onclick: savePreset }, '💾 Lưu kiểu')),
        el('div', {}, lbl('Font:', S.font), lbl('Cỡ chữ (khung 1080):', S.size), lbl('Đậm:', S.bold), lbl('Màu chữ:', S.color), lbl('Màu viền/nền:', S.outlineColor), lbl('Độ dày viền:', S.outline)),
        el('div', {}, lbl('Nền mờ:', S.box), lbl('Độ đậm nền:', S.boxOpacity), lbl('Vị trí:', S.position), lbl('Lề dọc (px):', S.marginV)),
        el('p', { class: 'mut' }, 'Chữ Hán dùng font MS Song. Cỡ/viền/lề nhập theo khung 1080 - chọn 720p tự co lại cho y hệt.'),
        el('button', { class: 'btn', onclick: preview }, '👁 Xem trước khung hình'), el('div', {}, pvImg)),
      el('div', { class: 'card' }, el('h3', {}, '5. Thông tin YouTube'),
        el('div', {}, 'Tiêu đề:', title), el('div', {}, 'Mô tả:', desc), el('div', {}, 'Tags (cách nhau dấu phẩy):', tags),
        el('div', {}, lbl('Playlist YouTube:', ytPl), lbl('Quyền riêng tư:', privSel), lbl('Hẹn giờ đăng:', pubAt), lbl('Ngôn ngữ phụ đề:', capLang))),
      el('div', { class: 'card row' }, el('button', { class: 'btn primary', onclick: () => submit(false) }, '🎬 Dựng video'),
        el('button', { class: 'btn', onclick: () => submit(true) }, '🚀 Dựng & đăng')),
      el('h3', {}, 'Video ghép tay gần đây'), jobsBox);
  }

  PAGES.manual = pageManual;
  const after = document.querySelector('#nav button[data-page="jobs"]');
  if (after && !document.querySelector('#nav button[data-page="manual"]')) {
    const b = document.createElement('button'); b.dataset.page = 'manual'; b.textContent = '🎬 Video ghép tay'; b.onclick = () => nav('manual'); after.after(b);
  }
})();
