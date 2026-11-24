# Third-party notices

This package bundles the following third-party software. Each keeps its own license.

| Component | Version | License | Location | License text |
|---|---|---|---|---|
| mermaid | 11.17.2 | MIT | `packs/core/assets/mermaid/mermaid.min.js` | `packs/core/assets/mermaid/mermaid-LICENSE.txt` |
| elkjs | 0.12.0 | EPL-2.0 (chosen from EPL-2.0 OR GPL-3.0-or-later), unmodified | `packs/datamodel/assets/erd/elk.bundled.js` | `packs/datamodel/assets/erd/elkjs-LICENSE.txt` (source: https://github.com/kieler/elkjs) |
| Preact | 10.29.8 | MIT | `packs/core/assets/docs-site/vendor/preact.js` · `preact-hooks.js` | `packs/core/assets/docs-site/vendor/preact-LICENSE.txt` |
| htm | 3.1.1 | Apache-2.0 | `packs/core/assets/docs-site/vendor/htm.js` | `packs/core/assets/docs-site/vendor/htm-LICENSE.txt` |
| MiniSearch | 7.2.0 | MIT | `packs/core/assets/docs-site/vendor/minisearch.js` | `packs/core/assets/docs-site/vendor/minisearch-LICENSE.txt` |
| perfect-freehand | 1.2.3 | MIT | `packs/core/assets/docs-site/vendor/perfect-freehand.js` (wrapped as a browser global, otherwise unmodified) | `packs/core/assets/docs-site/vendor/perfect-freehand-LICENSE.txt` |
| Frappe Gantt | 1.2.2 | MIT | `packs/core/assets/docs-site/vendor/frappe-gantt.js` · `frappe-gantt.css` (unmodified, loaded only on the project site gantt screen) | `packs/core/assets/docs-site/vendor/frappe-gantt-LICENSE.txt` |
| markdown-it (+ entities, linkify-it, mdurl, punycode.js, uc.micro) and markdown-it-cjk-friendly (+ get-east-asian-width) | 15.0.2 / 3.0.0 | MIT (entities: BSD-2-Clause) | `packs/core/lib/vendor/markdown-it.js` (bundled with esbuild, unmodified) | `packs/core/lib/vendor/markdown-it-LICENSES.txt` |
| Lucide icons (SVG paths: pen, printer, theme, search, menu, arrows, message, star, ink toolbar) | - | ISC | `packs/core/lib/mdsite.js` (`ICON_PATHS`), `packs/core/assets/docs-site/src/00-core.js` (`DS.ICON`), `packs/core/assets/docs-site/src/60-ink.js` (`ICO`), `packs/core/assets/docs-site/shared/10-sidehead.js` | below |

Generated documentation sites carry these libraries in `assets/vendor.js` with all license texts in `assets/vendor-LICENSES.txt`.

The mermaid bundle also contains notices of its own dependencies (for example DOMPurify, lodash) inside the minified file.

## Lucide (ISC)

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```
