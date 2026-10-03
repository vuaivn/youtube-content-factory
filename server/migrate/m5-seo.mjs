// m5-seo.mjs — kho SEO nạp từ THƯ MỤC FILE (02/10). Chạy lại nhiều lần không sao.
import { all, run } from '../db/db.mjs';
export function migrateSeo() {
  const cols = all('PRAGMA table_info(text_pool)').map(c => c.name);
  if (!cols.includes('root_dir')) run('ALTER TABLE text_pool ADD COLUMN root_dir TEXT');        // NULL = nhập tay trên web như cũ
  if (!cols.includes('last_scan')) run('ALTER TABLE text_pool ADD COLUMN last_scan TEXT');      // JSON kết quả quét gần nhất
}
