# Task 01: Add Browser Entry Point to @sweny-ai/core

## Why
Studio runs in the browser (Vite SPA + lib build). The old `@sweny-ai/engine` had `dist/browser.js` that excluded Node.js built-ins. `@sweny-ai/core` needs the same pattern — a `./browser` export that Studio and the docs site can import.

## What to do

1. **Create `packages/core/src/browser.ts`** — re-export everything from `index.ts` EXCEPT `ClaudeClient` (which imports `@anthropic-ai/sdk`, a Node-only dependency). The browser entry exports types + schema + studio adapter + skills (skills use `fetch` which is available in browsers).

2. **Add `./browser` to package.json exports:**
   ```json
   "./browser": "./dist/browser.js"
   ```
   And add to `typesVersions`:
   ```json
   "browser": ["dist/browser.d.ts"]
   ```

3. **Add `./studio` to package.json exports** (the studio adapter):
   ```json
   "./studio": "./dist/studio.js"
   ```
   And add to `typesVersions`:
   ```json
   "studio": ["dist/studio.d.ts"]
   ```

4. **Verify** `npx tsc --noEmit` passes, then `npm run build` produces dist/browser.js and dist/studio.js.

## Files to modify
- `packages/core/src/browser.ts` (CREATE)
- `packages/core/package.json` (EDIT exports + typesVersions)

## Acceptance criteria
- `import { Workflow, execute, triageWorkflow } from '@sweny-ai/core/browser'` works
- `import { workflowToFlow } from '@sweny-ai/core/studio'` works
- No Node.js built-ins in browser.ts import chain (no @anthropic-ai/sdk)
- TypeScript compiles clean
