import { mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { loadTokens, loadSources, resolveTokens, renderPreview, lint } from './lib.mjs';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'braze/content-blocks'), { recursive: true });
await mkdir(join(out, 'braze/templates'), { recursive: true });
await mkdir(join(out, 'preview'), { recursive: true });

const tokens = await loadTokens();
const mock = JSON.parse(await readFile(join(root, 'mock/catalog.json'), 'utf8'));
const { blocks, templates } = await loadSources();

// 1. Braze-ready files: tokens resolved, Braze Liquid untouched.
for (const [name, src] of Object.entries(blocks)) await writeFile(join(out, 'braze/content-blocks', `${name}.html`), resolveTokens(src, tokens));
for (const [name, src] of Object.entries(templates)) await writeFile(join(out, 'braze/templates', `${name}.html`), resolveTokens(src, tokens));

// 2. Previews with mock Catalog data, plus a lint report.
const report = { builtAt: new Date().toISOString(), templates: {}, blocks: {} };
for (const [name, src] of Object.entries(templates)) {
  const html = await renderPreview(src, blocks, mock, tokens);
  await writeFile(join(out, 'preview', `${name}.html`), html);
  report.templates[name] = lint(html);
}
for (const name of Object.keys(blocks).filter((n) => n !== 'email_styles')) {
  report.blocks[name] = { bytes: Buffer.byteLength(resolveTokens(blocks[name], tokens)) , problems: lint(resolveTokens(blocks[name], tokens), { full: false }).problems };
}
await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
await writeFile(join(out, 'tokens.json'), JSON.stringify(tokens, null, 2));

// 3. Site: copy the page next to the outputs so Vercel serves one folder.
await writeFile(join(out, 'index.html'), await readFile(join(root, 'site/index.html')));
await cp(join(root, 'site/img'), join(out, 'img'), { recursive: true });
const t = report.templates.price_drop;
console.log(`price_drop: ${(t.bytes / 1024).toFixed(1)} KB, ${t.problems.length} problems`);
for (const [n, b] of Object.entries(report.blocks)) console.log(`${n}: ${b.problems.length} problems`);
