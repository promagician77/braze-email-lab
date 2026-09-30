# braze-email-lab

Refreshed email blocks for Braze, built from one set of design tokens.

- `blocks/` - Content Block sources (`email_header`, `email_hero`, `email_wine_card`, `email_cta`, `email_text`, `email_footer`, `email_styles`)
- `templates/price_drop.liquid` - a trigger template: the data layer at the top is untouched, only the presentation below uses the new blocks
- `tokens.json` - colors (light and dark), type, spacing. Drives the blocks and the guidelines page.

```bash
npm install
npm test     # 9 checks: data layer unchanged, Catalog rendering, fallbacks, Gmail size, Outlook-safe markup, dark mode coverage
npm run build
```

`npm run build` writes:
- `dist/braze/content-blocks/*.html` - paste into Braze as Content Blocks with the same names
- `dist/braze/templates/price_drop.html` - the template, still in Braze Liquid
- `dist/preview/` - rendered previews using `mock/catalog.json`
- `dist/report.json` - lint results

The preview harness translates Braze-only syntax (`content_blocks.${...}`, `catalog_items`, `catalog_selection_items`, `abort_message`, `${attribute}`) so a standard Liquid engine can render it. It's for previewing only; the Braze files keep Braze syntax.

Previews approximate dark mode. Final testing belongs in Litmus or Email on Acid.

Deploy: import in Vercel; `vercel.json` sets the build and output folder.
