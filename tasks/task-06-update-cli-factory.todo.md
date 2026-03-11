# Task 06: Update CLI Provider Factory

## Context

The CLI provider factory (`packages/cli/src/providers/index.ts`) creates and registers
all providers into the registry. It needs to reflect any interface/naming changes.

After Tasks 02-03:
- `GitProvider` and `RepoProvider` are available as distinct types
- `LabelHistoryCapable` replaces `TriageHistoryCapable`

The factory behavior doesn't change — it still instantiates the same providers.
This is cleanup and future-proofing.

Depends on: Tasks 02, 03 complete.

## Files to Change

### `packages/cli/src/providers/index.ts`

1. Update imports — remove any references to removed types:
   ```typescript
   // Remove if present:
   // import { FingerprintCapable, TriageHistoryCapable, canListTriageHistory } from ...
   ```

2. The factory still registers under `"sourceControl"` — no registry key change.
   Both `createProviders` and `createImplementProviders` stay the same.

3. If any logging or debug code references old capability names, update them.

### `packages/cli/tests/`

Search for any test mocks that use old interface names:
```bash
grep -rn "listTriageHistory\|TriageHistoryCapable\|searchByFingerprint\|FingerprintCapable" packages/cli/tests/
```
Update any found references.

## Verification

```bash
cd packages/cli
npm run typecheck   # must pass
npm test            # must pass (163 tests)
```

## Changeset

Create `.changeset/cli-factory-cleanup.md`:
```md
---
"@sweny-ai/cli": patch
---

Updated provider factory imports to reflect renamed provider interfaces.
No behavior changes.
```

## Commit Message
```
fix(cli): update provider factory for renamed interfaces

Remove stale references to TriageHistoryCapable, FingerprintCapable.
```
