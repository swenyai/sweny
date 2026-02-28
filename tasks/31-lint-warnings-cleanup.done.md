# Task 31: Reduce ESLint Warnings

## Goal
Reduce the ~173 ESLint warnings. Focus on the most impactful categories.

## Context
Current warnings breakdown:
- ~120 `@typescript-eslint/no-non-null-assertion` (mostly test files)
- ~20 `no-console` (logger impls, CLI output, entry point error handlers)
- ~4 `@typescript-eslint/no-explicit-any` (generated .astro files + test mocks)
- ~3 `@typescript-eslint/no-unused-vars`

## Implementation

### 1. Disable non-null-assertion in test files
Update `eslint.config.js` to add a test file override:
```js
{
  files: ["**/tests/**/*.ts", "**/*.test.ts"],
  rules: {
    "@typescript-eslint/no-non-null-assertion": "off",
  },
}
```
This removes ~120 warnings since non-null assertions in tests are safe (test setup guarantees).

### 2. Add eslint-disable comments for legitimate console usage
- `packages/agent/src/logger.ts` — logger implementation uses console (add file-level disable for no-console)
- `packages/agent/src/cli.ts` — CLI REPL output (add file-level disable for no-console)
- `packages/agent/src/audit/console.ts` — console audit logger (add file-level disable)
- `packages/agent/src/health.ts` — health server startup log (inline disable)
- `packages/agent/src/index.ts` — fatal error handler (inline disable)
- `packages/providers/src/logger.ts` — logger implementation (file-level disable)

### 3. Exclude generated files
Add to eslint.config.js ignores: `"packages/web/.astro/**"` to skip generated Astro type files.

### 4. Fix remaining unused variables
Check for any `@typescript-eslint/no-unused-vars` warnings and either use or remove the variables.

## Verification
```bash
npm run lint 2>&1 | tail -5
# Target: 0 errors, <20 warnings (down from 173)
npm test --workspace=packages/agent --workspace=packages/action --workspace=packages/providers
```

## Commit
```bash
git add eslint.config.js packages/agent/src/logger.ts packages/agent/src/cli.ts packages/agent/src/audit/console.ts packages/agent/src/health.ts packages/agent/src/index.ts packages/providers/src/logger.ts
git commit -m "chore: reduce ESLint warnings from 173 to <20

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
