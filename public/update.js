// update.js — badge "Có bản mới" + nút cập nhật 1 chạm (18/11/2026). Dùng modal/el/toast của app.js.
(() => {
  const box = el('div', { id: 'update-box' });
  $('#nav').insertBefore(box, $('#sysinfo'));
  let info = null;

  async function check(force) {
    try {
      const r = await fetch('/api/update/check' + (force ? '?force=1' : ''), { cache: 'no-store' });
      info = await r.json();
    } catch { return; }
    box.replaceChildren(
      info.hasUpdate
        ? el('button', { class: 'btn sm primary', onclick: openPanel, title: 'Bấm để xem nội dung bản mới' }, `🔔 Có bản mới v${info.latest}`)
        : el('div', { class: 'muted', style: 'font-size:11.5px;padding:4px 2px;cursor:pointer', title: 'Bấm để kiểm tra lại', onclick: () => check(true) },
          `Phiên bản v${info.current}${info.head ? ' (' + info.head + ')' : ''}`));
  }

  function openPanel() {
    const log = el('pre', { style: 'max-height:220px;overflow:auto;font-size:12px;white-space:pre-wrap;display:none' });
    const status = el('div', { style: 'margin:8px 0' });
    const btn = el('button', { class: 'btn primary', onclick: () => run(btn, status, log) }, 'Cập nhật');
    if (info.busy) status.replaceChildren(el('span', { class: 'badge warn' }, 'Đang dựng video, cập nhật sau'));
    modal(
      el('h3', {}, `Bản mới v${info.latest} (đang dùng v${info.current})`),
      el('pre', { style: 'max-height:320px;overflow:auto;white-space:pre-wrap;font-size:12.5px' }, info.changelog || '(không có ghi chú)'),
      el('div', { class: 'muted', style: 'font-size:12px' }, 'Dữ liệu (data, secrets, config.json) được sao lưu vào backups\\ trước khi cập nhật. App sẽ tắt ~30 giây rồi tự bật lại.'),
      status,
      el('div', { style: 'display:flex;gap:8px' }, btn, el('button', { class: 'btn', onclick: closeModal }, 'Đóng')),
      log);
  }

  async function run(btn, status, log) {
    if (!confirm('Cập nhật lên v' + info.latest + '? App sẽ khởi động lại.')) return;
    btn.disabled = true;
    const before = info.head;
    status.textContent = 'Đang cập nhật…';
    try {
      const rr = await fetch('/api/update/run', { method: 'POST' });
      if (rr.status === 409 || rr.status === 400) { const j = await rr.json().catch(() => ({})); return fail(status, log, btn, j.error || 'Đang dựng video, cập nhật sau'); }
    } catch { /* server tắt ngay sau khi trả lời */ }
    const t0 = Date.now();
    await new Promise(r => setTimeout(r, 4000));
    while (Date.now() - t0 < 120_000) {
      status.textContent = `Đang cập nhật… (${Math.round((Date.now() - t0) / 1000)} giây)`;
      try {
        const r = await fetch('/api/update/check', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          if (j.head && j.head !== before) { status.textContent = 'Cập nhật xong, đang tải lại…'; setTimeout(() => location.reload(), 800); return; }
          // server đã lên nhưng vẫn bản cũ = bị hủy / rollback
          if (Date.now() - t0 > 8000) return fail(status, log, btn, 'Server đã chạy lại nhưng vẫn là bản cũ (cập nhật bị hủy hoặc đã rollback).');
        }
      } catch { /* server đang khởi động lại */ }
      await new Promise(r => setTimeout(r, 2000));
    }
    fail(status, log, btn, 'Quá 120 giây server chưa lên lại.');
  }

  async function fail(status, log, btn, msg) {
    status.replaceChildren(el('span', { class: 'badge bad' }, 'Lỗi'), ' ' + msg);
    btn.disabled = false;
    try { const j = await (await fetch('/api/update/log', { cache: 'no-store' })).json(); log.textContent = j.log || '(update.log trống)'; log.style.display = 'block'; }
    catch { log.textContent = 'Không đọc được logs\\update.log'; log.style.display = 'block'; }
  }

  check();
  setInterval(check, 30 * 60 * 1000);
})();
