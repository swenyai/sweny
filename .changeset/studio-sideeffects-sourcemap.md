---
"@sweny-ai/studio": patch
---

Library build: add sideEffects declaration and source maps.

- `"sideEffects": ["dist-lib/style.css"]` prevents bundlers from incorrectly
  tree-shaking the CSS import
- `sourcemap: true` in vite.lib.config.ts makes the bundled output debuggable
