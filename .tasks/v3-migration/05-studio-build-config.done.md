# Task 05: Update Studio Build Config (package.json, Vite, deps)

## Why
Studio currently peer-depends on `@sweny-ai/engine` and aliases it to `engine/dist/browser.js` in Vite. After migration, it should peer-depend on `@sweny-ai/core` and alias to `core/dist/browser.js`.

## What to do

### package.json
- Replace peerDependency: `@sweny-ai/engine` → `@sweny-ai/core`
- Bump studio version for v3

### vite.config.ts (SPA dev server)
- Change alias: `"@sweny-ai/engine"` → remove
- Add alias: `"@sweny-ai/core"` → `resolve(__dirname, "../../packages/core/dist/browser.js")`
- Keep elkjs alias as-is
- Update manual chunks if engine was listed

### vite.lib.config.ts (Library build)
- Change alias: `"@sweny-ai/engine"` → remove
- Add alias: `"@sweny-ai/core"` → `resolve(__dirname, "../../packages/core/dist/browser.js")`
- Change rollup external: `"@sweny-ai/engine"` → `"@sweny-ai/core"`, `"@sweny-ai/core/studio"`, `"@sweny-ai/core/workflows"`, `"@sweny-ai/core/schema"`

### lib-viewer.ts and lib-editor.ts
- Verify exports use new types
- Update any re-exports that reference engine types

## Files to modify
- `packages/studio/package.json` (EDIT)
- `packages/studio/vite.config.ts` (EDIT)
- `packages/studio/vite.lib.config.ts` (EDIT)
- `packages/studio/src/lib-viewer.ts` (CHECK/UPDATE)
- `packages/studio/src/lib-editor.ts` (CHECK/UPDATE)

## Acceptance criteria
- `npm run build` succeeds in packages/studio (SPA build)
- `npm run build:lib` succeeds (library build)
- `npx tsc --noEmit` passes
- No references to `@sweny-ai/engine` anywhere in packages/studio
