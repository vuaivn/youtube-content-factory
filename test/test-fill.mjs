// test-fill.mjs — chế độ "tự thêm truyện cho đủ" KHÔNG BAO GIỜ được vượt trần (30/09, lỗi KCNQ 115,1' > 115').
// Bốc 200 seed cho MỌI playlist dùng 'fill', dữ liệu THẬT từ DB. Chạy: node test/test-fill.mjs
const { get, all } = await import('../server/db/db.mjs');
const { buildPlan } = await import('../server/recipe/plan.mjs');
let pass = 0, fail = 0;
for (const pl of all('SELECT * FROM playlist')) {
  const recipe = get('SELECT * FROM recipe WHERE id=?', pl.recipe_id);
  recipe.body_spec = JSON.parse(recipe.body_spec); recipe.tail_spec = JSON.parse(recipe.tail_spec);
  if (recipe.body_spec.stories !== 'fill') { console.log(`  bỏ qua ${pl.id} (không dùng fill)`); continue; }
  const rows = all(`SELECT a.*, ap.kind AS pool_kind FROM playlist_pool pp JOIN asset_pool ap ON ap.id=pp.pool_id
    JOIN asset a ON a.pool_id=ap.id AND a.status='active' WHERE pp.playlist_id=?`, pl.id);
  const by = k => rows.filter(r => r.pool_kind === k);
  const assets = { hooks: by('hook'), stories: by('story'), outros: by('outro'), shots: by('shot'), musics: by('music') };
  let bad = 0, worst = -1e9, minStories = 1e9;
  for (let seed = 1; seed <= 200; seed++) {
    const r = buildPlan(recipe, assets, { seed });
    if (!r.ok) { bad++; if (bad <= 2) console.log(`    seed ${seed}: ${r.errors.join(' · ')}`); continue; }
    const tailFixed = r.plan.total_s - r.plan.voice_end_s;
    worst = Math.max(worst, r.plan.voice_end_s - (r.plan.total_s - 300 - 7200 * (recipe.tail_spec.some(t => t.kind === 'black') ? 1 : 0)));
    minStories = Math.min(minStories, r.plan.picked.stories.length);
    if (r.plan.total_s !== recipe.total_seconds || r.plan.timeline.at(-1).end_s > recipe.total_seconds + 0.01) bad++;
  }
  const ok = bad === 0;
  ok ? pass++ : fail++;
  console.log(`${ok ? '  DAT  ' : '  TRUOT'} ${pl.id}: 200 seed · lỗi ${bad} · ít nhất ${minStories} truyện`);
}
console.log(`\n${pass} DAT / ${fail} TRUOT`);
process.exit(fail ? 1 : 0);
