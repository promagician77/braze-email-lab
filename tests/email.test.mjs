import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadTokens, loadSources, resolveTokens, renderPreview, lint, GMAIL_CLIP_BYTES } from '../scripts/lib.mjs';

const tokens = await loadTokens();
const { blocks, templates } = await loadSources();
const mock = JSON.parse(await readFile(new URL('../mock/catalog.json', import.meta.url), 'utf8'));
const html = await renderPreview(templates.price_drop, blocks, mock, tokens);

test('trigger data layer is byte-for-byte unchanged', async () => {
  const src = templates.price_drop;
  const start = src.indexOf('\n', src.indexOf('===== DATA LAYER')) + 1;
  const end = src.indexOf('{% comment %} ===== PRESENTATION');
  const original = await readFile(new URL('./original_data_layer.liquid', import.meta.url), 'utf8');
  assert.equal(src.slice(start, end), original);
});

test('renders the saved wine from the Catalog, with the old price struck through', () => {
  assert.match(html, /Barolo Serralunga 2019/);
  assert.match(html, /line-through;">349&nbsp;DKK/);
  assert.match(html, /<strong>289&nbsp;DKK<\/strong>/);
  assert.match(html, /Good timing, Freja\./);
});

test('renders the Selection items, and hides ratings a wine does not have yet', () => {
  assert.match(html, /Langhe Nebbiolo 2021/);
  assert.match(html, /Rosso di Montalcino 2022/);
  assert.equal((html.match(/ratings\)/g) || []).length, 2); // Barolo + Langhe, not Rosso
});

test('first name falls back when the attribute is empty', async () => {
  const noName = structuredClone(mock); noName.user.first_name = '';
  assert.match(await renderPreview(templates.price_drop, blocks, noName, tokens), /Good timing, there\./);
});

test('a wine missing from the Catalog aborts the send instead of sending a broken email', async () => {
  const missing = structuredClone(mock); missing.event_properties.wine_id = 'w-0000';
  await assert.rejects(renderPreview(templates.price_drop, blocks, missing, tokens), /aborted/);
});

test('full email passes every email check and stays under the Gmail clip limit', () => {
  const r = lint(html);
  assert.deepEqual(r.problems, []);
  assert.ok(r.bytes < GMAIL_CLIP_BYTES / 4, `${r.bytes} bytes`);
});

test('the linter catches the mistakes it is meant to catch', () => {
  const bad = '<table><tr><td style="display:flex"><img src="x.png"><a class="btn" href="#">Go</a></td></tr></table>';
  const rules = lint(bad).problems.map((p) => p.rule);
  for (const r of ['outlook-css', 'img-alt', 'img-width', 'table-role', 'outlook-button', 'dark-apple', 'dark-outlook']) assert.ok(rules.includes(r), r);
});

test('Braze files keep Braze syntax, only tokens are resolved', () => {
  const out = resolveTokens(templates.price_drop, tokens);
  assert.match(out, /\{\{content_blocks\.\$\{email_wine_card\}\}\}/);
  assert.match(out, /\{% catalog_items wines \{\{wine_id\}\} %\}/);
  assert.doesNotMatch(out, /\[\[/);
});

test('every color class used in blocks has a dark mode rule', () => {
  const styles = blocks.email_styles;
  const used = new Set(Object.values(blocks).join('').match(/class="([\w\s-]+)"/g).flatMap((m) => m.slice(7, -1).split(/\s+/)));
  for (const c of ['bg', 'surface', 'ink', 'sub', 'rating'].filter((x) => used.has(x))) {
    assert.match(styles, new RegExp(`prefers-color-scheme[\\s\\S]*\\.${c} \\{`), `${c} in Apple dark rules`);
    assert.match(styles, new RegExp(`\\[data-ogsc\\] \\.${c} \\{`), `${c} in Outlook dark rules`);
  }
});
