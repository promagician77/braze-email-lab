import { Liquid } from 'liquidjs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
export const GMAIL_CLIP_BYTES = 102 * 1024;

export async function loadTokens() {
  return JSON.parse(await readFile(join(root, 'tokens.json'), 'utf8'));
}

// [[color.accent]] -> "#8A1538". Resolved at build, so what you paste into Braze is plain HTML + Liquid.
export function resolveTokens(src, tokens) {
  return src.replace(/\[\[([\w.]+)\]\]/g, (m, path) => {
    const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), tokens);
    if (v === undefined) throw new Error(`Unknown token ${m}`);
    return String(v);
  });
}

export async function loadSources() {
  const blocks = {};
  for (const f of (await readdir(join(root, 'blocks'))).filter((x) => x.endsWith('.liquid'))) {
    blocks[f.replace('.liquid', '')] = await readFile(join(root, 'blocks', f), 'utf8');
  }
  const templates = {};
  for (const f of (await readdir(join(root, 'templates'))).filter((x) => x.endsWith('.liquid'))) {
    templates[f.replace('.liquid', '')] = await readFile(join(root, 'templates', f), 'utf8');
  }
  return { blocks, templates };
}

// Braze-only syntax, translated so a standard Liquid engine can preview it.
// Nothing here is shipped to Braze; the Braze files keep the original syntax.
export function toPreviewLiquid(src) {
  return src
    .replace(/\{\{\s*content_blocks\.\$\{(\w+)\}\s*\}\}/g, "{% include '$1' %}")
    .replace(/event_properties\.\$\{(\w+)\}/g, 'event_properties.$1')
    .replace(/\{\{\s*\$\{(\w+)\}\s*\}\}/g, '{{ user.$1 }}')
    .replace(/\$\{(\w+)\}/g, 'user.$1');
}

export function makeEngine(blocks, mock) {
  const engine = new Liquid({ templates: Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, toPreviewLiquid(v)])), strictFilters: true });
  const lookup = (catalog, id) => mock.catalogs?.[catalog]?.[id];
  // {% catalog_items wines {{wine_id}} %} -> items = [item]
  engine.registerTag('catalog_items', {
    parse(tok) { [this.catalog, ...this.args] = tok.args.trim().split(/\s+/); },
    *render(ctx) {
      const ids = [];
      for (const a of this.args) ids.push(/^\{\{/.test(a) ? yield this.liquid.parseAndRender(a, ctx.getAll()) : a);
      ctx.bottom().items = ids.map((id) => lookup(this.catalog, id)).filter(Boolean);
    },
  });
  // {% catalog_selection_items wines similar_under_budget %}
  engine.registerTag('catalog_selection_items', {
    parse(tok) { [this.catalog, this.selection] = tok.args.trim().split(/\s+/); },
    render(ctx) {
      const ids = mock.selections?.[this.catalog]?.[this.selection] ?? [];
      ctx.bottom().items = ids.map((id) => lookup(this.catalog, id)).filter(Boolean);
    },
  });
  engine.registerTag('abort_message', {
    parse(tok) { this.reason = tok.args; },
    render() { throw new Error(`Message aborted: ${this.reason}`); },
  });
  return engine;
}

export async function renderPreview(templateSrc, blocks, mock, tokens) {
  const resolvedBlocks = Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, resolveTokens(v, tokens)]));
  const engine = makeEngine(resolvedBlocks, mock);
  return engine.parseAndRender(toPreviewLiquid(resolveTokens(templateSrc, tokens)), structuredClone(mock));
}

// Email-specific checks on the rendered HTML. Each returns [] when clean.
export function lint(html, { full = true } = {}) {
  const problems = [];
  const add = (rule, detail) => problems.push({ rule, detail });
  const bytes = Buffer.byteLength(html, 'utf8');
  if (full && bytes > GMAIL_CLIP_BYTES) add('gmail-clip', `${(bytes / 1024).toFixed(1)} KB is over Gmail's ~102 KB clip limit`);
  const css = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]).join(';') + (html.match(/<style[\s\S]*?<\/style>/g) || []).join('');
  for (const bad of ['display:flex', 'display: flex', 'display:grid', 'display: grid', 'position:absolute', 'position: absolute']) {
    if (css.includes(bad)) add('outlook-css', `${bad} is ignored by Outlook desktop`);
  }
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt="/.test(m[0])) add('img-alt', 'image without alt text');
    if (!/\bwidth="\d+"/.test(m[0])) add('img-width', 'image without a width attribute (Outlook scales it wrong)');
  }
  for (const m of html.matchAll(/<table\b[^>]*>/g)) if (!/role="presentation"/.test(m[0])) add('table-role', 'layout table without role="presentation"');
  if (/\[\[[\w.]+\]\]/.test(html)) add('tokens', 'unresolved design token');
  if (/class="btn"/.test(html) && !/v:roundrect/.test(html)) add('outlook-button', 'button without a VML fallback for Outlook');
  if (full) {
    if (!/prefers-color-scheme:\s*dark/.test(html)) add('dark-apple', 'no prefers-color-scheme rules (Apple Mail, iOS)');
    if (!/\[data-ogsc\]/.test(html)) add('dark-outlook', 'no [data-ogsc] rules (Outlook.com, Outlook apps)');
    if (!/name="color-scheme"/.test(html)) add('dark-meta', 'missing color-scheme meta');
    if (!/<title>[^<]+<\/title>/.test(html)) add('title', 'missing or empty <title>');
  }
  return { bytes, problems };
}
