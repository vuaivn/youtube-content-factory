// routes-style.mjs — Kho kiểu chữ (thumbnail / phụ đề), xem thử, và XOÁ HẲN mục đã lưu trữ (08/10/2026).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from './config.mjs';
import { get, all, run, tx, logConfigChange } from './db/db.mjs';
import { validateParams, thumbVf, subtitleForceStyle, THUMB_FONTS, SUB_FONTS, LAYOUTS } from './recipe/styles.mjs';

// playlist.subtitle_style là chuỗi bộ dựng đang dùng → ghi lại mỗi khi chọn/sửa kiểu.
// Chưa chọn kiểu → giữ giá trị cũ 'brown-cream' (y như trước khi có tính năng này).
export function syncSubtitleStyle(playlistId) {
  const pl = get('SELECT subtitle_style_id FROM playlist WHERE id=?', playlistId);
  if (!pl?.subtitle_style_id) { run("UPDATE playlist SET subtitle_style='brown-cream' WHERE id=?", playlistId); return; }
  const st = get("SELECT params FROM style WHERE id=? AND kind='subtitle'", pl.subtitle_style_id);
  run('UPDATE playlist SET subtitle_style=? WHERE id=?', st ? subtitleForceStyle(JSON.parse(st.params)) : 'brown-cream', playlistId);
}
const needDelete = body => { if (String(body?.confirm ?? '').trim().toLowerCase() !== 'delete') throw new Error('Gõ chữ "delete" để xác nhận xoá'); };

export function registerStyleRoutes(route, { blockIfBusy }) {
  route('GET', '/api/style', () => ({
    styles: all(`SELECT s.*, (SELECT GROUP_CONCAT(pl.name, ' · ') FROM playlist pl WHERE pl.thumb_style_id=s.id OR pl.subtitle_style_id=s.id) AS used_by
      FROM style s ORDER BY s.kind, s.builtin DESC, s.name`).map(r => ({ ...r, params: JSON.parse(r.params) })),
    options: { thumb_fonts: Object.entries(THUMB_FONTS).map(([id, f]) => ({ id, name: f.name })), sub_fonts: SUB_FONTS, layouts: LAYOUTS },
  }));
  route('POST', '/api/style', (p, body) => {
    const kind = body.kind; const params = validateParams(kind, body.params);
    const name = String(body.name ?? '').trim(); if (!name) throw new Error('Thiếu tên kiểu');
    const id = (kind === 'thumb' ? 'thumb-' : 'sub-') + Date.now().toString(36);
    run('INSERT INTO style (id,kind,name,params,builtin) VALUES (?,?,?,?,0)', id, kind, name, JSON.stringify(params));
    return get('SELECT * FROM style WHERE id=?', id);
  });
  route('PUT', '/api/style/:id', (p, body) => {
    const st = get('SELECT * FROM style WHERE id=?', p.id); if (!st) throw new Error('Không có kiểu ' + p.id);
    const params = validateParams(st.kind, body.params);
    const name = String(body.name ?? st.name).trim() || st.name;
    tx(() => {
      logConfigChange('style', p.id, st, { ...st, name, params: JSON.stringify(params) });
      run("UPDATE style SET name=?, params=?, updated_at=datetime('now') WHERE id=?", name, JSON.stringify(params), p.id);
      for (const pl of all('SELECT id FROM playlist WHERE subtitle_style_id=?', p.id)) syncSubtitleStyle(pl.id);
    });
    return get('SELECT * FROM style WHERE id=?', p.id);
  });
  route('POST', '/api/style/:id/delete', (p, body) => {
    needDelete(body);
    const st = get('SELECT * FROM style WHERE id=?', p.id); if (!st) throw new Error('Không có kiểu ' + p.id);
    const users = all('SELECT name FROM playlist WHERE thumb_style_id=? OR subtitle_style_id=?', p.id, p.id);
    if (users.length) throw new Error('Kiểu đang dùng cho playlist: ' + users.map(u => u.name).join(', ') + ' — đổi kiểu ở playlist trước');
    logConfigChange('style', p.id, st, null);
    run('DELETE FROM style WHERE id=?', p.id);
    return { deleted: true };
  });

  // Xem thử: 1 khung hình thật từ kho shot của playlist (hoặc kho shot bất kỳ)
  route('POST', '/api/style/preview', (p, body) => {
    const kind = body.kind; const params = validateParams(kind, body.params);
    const shot = (body.playlist_id && get(`SELECT a.file_path FROM asset a JOIN playlist_pool pp ON pp.pool_id=a.pool_id JOIN asset_pool ap ON ap.id=a.pool_id
        WHERE pp.playlist_id=? AND ap.kind='shot' AND a.status='active' ORDER BY a.id LIMIT 1`, body.playlist_id))
      || get("SELECT a.file_path FROM asset a JOIN asset_pool ap ON ap.id=a.pool_id WHERE ap.kind='shot' AND ap.archived=0 AND a.status='active' ORDER BY a.id LIMIT 1");
    if (!shot) throw new Error('Chưa có kho video shot nào để lấy khung hình');
    const dir = path.join(config.workDir, 'preview'); fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, kind + '.jpg');
    let vf;
    if (kind === 'thumb') {
      const tt = (body.playlist_id && get(`SELECT t.line1, t.line2, t.sub_line FROM thumbnail_text t JOIN playlist pl ON pl.text_pool_id=t.pool_id
          WHERE pl.id=? AND t.status='active' ORDER BY t.id LIMIT 1`, body.playlist_id)) || { line1: 'BUÔNG BỎ', line2: 'ĐỂ AN LÒNG', sub_line: '' };
      vf = thumbVf(params, { line1: tt.line1, line2: tt.line2, sub_line: tt.sub_line || 'Nghe mỗi đêm · Ngủ ngon' });
    } else {
      const srt = path.join(dir, 'sample.srt');
      fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:10,000\nNgày ngày ông ngồi lặng lẽ bên cửa sổ,\nnghe tiếng chuông chùa vọng lại.\n', 'utf8');
      const esc = srt.replace(/\\/g, '/').replace(/:/g, '\\:');
      vf = `scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,subtitles='${esc}':force_style='${subtitleForceStyle(params)}'`;
    }
    const r = spawnSync(config.ffmpeg || 'ffmpeg', ['-y', '-v', 'error', '-ss', '3', '-i', shot.file_path, '-frames:v', '1', '-update', '1', '-vf', vf, '-q:v', '3', out], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0 || !fs.existsSync(out)) throw new Error('Tạo ảnh xem thử lỗi: ' + String(r.stderr || r.error || '').slice(-300));
    return { image: 'data:image/jpeg;base64,' + fs.readFileSync(out).toString('base64') };
  });

  // ===== XOÁ HẲN mục đã lưu trữ — bắt gõ "delete", chặn khi đang trong chuỗi =====
  function hardDeletePlaylist(id) {
    const pl = get('SELECT * FROM playlist WHERE id=?', id); if (!pl) return;
    logConfigChange('playlist', id, pl, null);
    run('DELETE FROM usage_log WHERE playlist_id=? OR job_id IN (SELECT id FROM job WHERE playlist_id=?)', id, id);
    run('DELETE FROM chain_item WHERE playlist_id=?', id);
    run('DELETE FROM job_step WHERE job_id IN (SELECT id FROM job WHERE playlist_id=?)', id);
    run('DELETE FROM job WHERE playlist_id=?', id);
    run('DELETE FROM playlist_pool WHERE playlist_id=?', id);
    for (const sc of all('SELECT id, playlist_ids FROM schedule')) {
      const ids = JSON.parse(sc.playlist_ids || '[]');
      if (ids.includes(id)) run('UPDATE schedule SET playlist_ids=? WHERE id=?', JSON.stringify(ids.filter(x => x !== id)), sc.id);
    }
    run('DELETE FROM playlist WHERE id=?', id);
    const rec = get('SELECT * FROM recipe WHERE id=?', pl.recipe_id);
    if (rec && !get('SELECT 1 FROM playlist WHERE recipe_id=?', rec.id)) run('DELETE FROM recipe WHERE id=?', rec.id);
  }
  route('POST', '/api/archive/playlist/:id/delete', (p, body) => {
    needDelete(body);
    const pl = get('SELECT * FROM playlist WHERE id=?', p.id); if (!pl) throw new Error('Không có playlist ' + p.id);
    if (!pl.archived) throw new Error('Chỉ xoá được playlist đã lưu trữ');
    blockIfBusy([p.id], 'Playlist');
    tx(() => hardDeletePlaylist(p.id));
    return { deleted: true };
  });
  route('POST', '/api/archive/channel/:id/delete', (p, body) => {
    needDelete(body);
    const ch = get('SELECT * FROM channel WHERE id=?', p.id); if (!ch) throw new Error('Không có kênh ' + p.id);
    if (!ch.archived) throw new Error('Chỉ xoá được kênh đã lưu trữ');
    const pls = all('SELECT id FROM playlist WHERE channel_id=?', p.id).map(r => r.id);
    blockIfBusy(pls, 'Kênh');
    tx(() => {
      for (const id of pls) hardDeletePlaylist(id);
      for (const t of all('SELECT id FROM text_pool WHERE channel_id=?', p.id).map(r => r.id)) {
        run('UPDATE usage_log SET seo_item_id=NULL WHERE seo_item_id IN (SELECT id FROM seo_item WHERE pool_id=?)', t);
        run('UPDATE usage_log SET thumbnail_text_id=NULL WHERE thumbnail_text_id IN (SELECT id FROM thumbnail_text WHERE pool_id=?)', t);
        run('UPDATE playlist SET text_pool_id=NULL WHERE text_pool_id=?', t);
        run('DELETE FROM seo_item WHERE pool_id=?', t);
        run('DELETE FROM thumbnail_text WHERE pool_id=?', t);
        run('DELETE FROM text_pool WHERE id=?', t);
      }
      run('UPDATE asset_pool SET channel_id=NULL WHERE channel_id=?', p.id);
      logConfigChange('channel', p.id, ch, null);
      run('DELETE FROM channel WHERE id=?', p.id);
    });
    // file đăng nhập kênh → secrets/_da-xoa (KHÔNG xoá hẳn)
    let kept = null;
    const src = ch.secrets_file && (path.isAbsolute(ch.secrets_file) ? ch.secrets_file : path.join(config.secretsDir, ch.secrets_file));
    if (src && fs.existsSync(src)) {
      const dd = path.join(config.secretsDir, '_da-xoa'); fs.mkdirSync(dd, { recursive: true });
      kept = path.join(dd, Date.now() + '-' + path.basename(src));
      fs.copyFileSync(src, kept); fs.unlinkSync(src);
    }
    return { deleted: true, playlists: pls.length, secrets_kept_at: kept };
  });
  route('POST', '/api/archive/pool/:id/delete', (p, body) => {
    needDelete(body);
    const pool = get('SELECT * FROM asset_pool WHERE id=?', p.id); if (!pool) throw new Error('Không có kho ' + p.id);
    if (!pool.archived) throw new Error('Chỉ xoá được kho đã lưu trữ');
    blockIfBusy(all('SELECT playlist_id FROM playlist_pool WHERE pool_id=?', p.id).map(r => r.playlist_id), 'Kho');
    tx(() => {
      logConfigChange('asset_pool', p.id, pool, null);
      run('UPDATE usage_log SET asset_id=NULL WHERE asset_id IN (SELECT id FROM asset WHERE pool_id=?)', p.id);
      run('DELETE FROM asset WHERE pool_id=?', p.id);
      run('DELETE FROM playlist_pool WHERE pool_id=?', p.id);
      run('DELETE FROM asset_pool WHERE id=?', p.id);
    });
    return { deleted: true, files_kept: pool.root_dir };
  });
  route('POST', '/api/archive/asset/:id/delete', (p, body) => {
    needDelete(body);
    const a = get('SELECT * FROM asset WHERE id=?', p.id); if (!a) throw new Error('Không có mục ' + p.id);
    if (!['hidden', 'removed'].includes(a.status)) throw new Error('Chỉ xoá được mục đã ẩn');
    tx(() => { run('UPDATE usage_log SET asset_id=NULL WHERE asset_id=?', p.id); run('DELETE FROM asset WHERE id=?', p.id); });
    return { deleted: true };
  });
}
