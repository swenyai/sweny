# Issues Report — 2026-03-12

## Issue 1: JSON Schema Missing `provider` Field Causes Engine Schema Tests to Fail

- **Severity**: High (CI-blocking on main)
- **Environment**: Production (main branch, every CI run)
- **Frequency**: 100% — every CI run on main since `provider` was added to `StateDefinition`

### Description

`packages/engine/src/schema.test.ts` validates `triageDefinition` and `implementDefinition` against the AJV-compiled JSON schema at `packages/engine/schema/recipe-definition.schema.json`. Both definitions include `provider` fields on their state nodes, but the JSON schema's `StateDefinition` object has `additionalProperties: false` and does not list `provider` as a valid property. AJV rejects the definitions and returns 9 and 4 validation errors respectively.

### Evidence

CI logs (2026-03-12T01:11 run, run_id 22982090505):
```
FAIL src/schema.test.ts > recipe-definition.schema.json > triageDefinition passes schema validation
AssertionError: expected [ { …(5) }, { …(5) }, { …(5) }, …(6) ] to be null

FAIL src/schema.test.ts > recipe-definition.schema.json > implementDefinition passes schema validation
AssertionError: expected [ { …(5) }, { …(5) }, { …(5) }, …(1) ] to be null

Test Files  1 failed | 22 passed (23)
      Tests  2 failed | 377 passed (379)
```

Observed on every CI run on main: 00:30, 00:32, 01:11 on 2026-03-12.

### Root Cause Analysis

The TypeScript `StateDefinition` interface in `packages/engine/src/types.ts` has (line 197):
```typescript
provider?: string;
```

But the JSON schema (`packages/engine/schema/recipe-definition.schema.json`) `StateDefinition` block:
```json
{
  "additionalProperties": false,
  "properties": {
    "phase": { ... },
    "description": { ... },
    "critical": { ... },
    "next": { ... },
    "on": { ... }
  }
}
```
does NOT include `provider`. The TypeScript type and JSON schema diverged when `provider` was added to the TS type.

### Impact

- `npm test` fails in `packages/engine` on every CI run
- CI status on main is red on every push
- Engine package tests show 2 failing / 377 passing

### Suggested Fix

Add `provider` to `StateDefinition` properties in the JSON schema:
```json
"provider": {
  "type": "string",
  "description": "Provider category this state primarily relies on (e.g. 'observability', 'issueTracking', 'sourceControl', 'codingAgent', 'notification'). Pure metadata — no runtime effect."
}
```

### Files to Modify

- `packages/engine/schema/recipe-definition.schema.json`

### Confidence Level

Very high — direct schema/type mismatch, single property addition.

### GitHub Issues Status

No existing GitHub Issues issue found — new issue will be created.
