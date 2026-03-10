---
"@sweny-ai/studio": patch
---

Library build quality improvements: source maps, correct sideEffects declaration.

- `vite.lib.config.ts`: enable `sourcemap: true` so bundled code is debuggable
- `package.json`: declare `"sideEffects": ["dist-lib/style.css"]` so bundlers do not
  tree-shake the CSS import away
