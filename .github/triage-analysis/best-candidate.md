<!-- TRIAGE_FINGERPRINT
error_pattern: AssertionError: expected [ { …(5) } ] to be null — validate.errors not null for triageDefinition/implementDefinition
service: sweny-ci / packages/engine
first_seen: 2026-03-12
run_id: 22982090505
-->

RECOMMENDATION: implement

TARGET_SERVICE: sweny
TARGET_REPO: swenyai/sweny

**GitHub Issues Issue**: None found - New issue will be created

# Engine Schema Missing provider Field Breaks Schema Validation Tests

## Summary

`packages/engine/src/schema.test.ts` validates the built-in recipe definitions against a JSON schema. The tests fail because the JSON schema's `StateDefinition` object has `additionalProperties: false` but omits the `provider` field that was added to the TypeScript `StateDefinition` interface. Every state node that uses `provider` (9 in triage, 4 in implement) causes an AJV validation error, making both schema tests fail on every CI run.

## Root Cause

The TypeScript type and JSON schema diverged. `packages/engine/src/types.ts` defines:

```typescript
export interface StateDefinition {
  phase: WorkflowPhase;
  description?: string;
  critical?: boolean;
  next?: string;
  on?: Record<string, string>;
  provider?: string;  // ← present in TS type
}
```

But `packages/engine/schema/recipe-definition.schema.json` defines:

```json
"StateDefinition": {
  "type": "object",
  "required": ["phase"],
  "additionalProperties": false,
  "properties": {
    "phase": { ... },
    "description": { ... },
    "critical": { ... },
    "next": { ... },
    "on": { ... }
    // ← provider is missing!
  }
}
```

`additionalProperties: false` causes AJV to emit one error per state that uses `provider`. Both `triageDefinition` (9 states with `provider`) and `implementDefinition` (4 states with `provider`) fail validation.

## Exact Code Change

**File**: `packages/engine/schema/recipe-definition.schema.json`

Add a `provider` entry to the `StateDefinition.properties` block (after `on`):

```json
"provider": {
  "type": "string",
  "description": "Provider category this state primarily relies on (e.g. 'observability', 'issueTracking', 'sourceControl', 'codingAgent', 'notification'). Pure metadata — no runtime effect. Used by Studio to surface required env vars per step."
}
```

## Test Plan

- [ ] `npm test` in `packages/engine` passes — both `triageDefinition passes schema validation` and `implementDefinition passes schema validation` green
- [ ] `npm run typecheck` in `packages/engine` still passes (no TS changes)
- [ ] Existing negative schema tests still pass (missing fields, invalid phase, empty states, bad semver)
- [ ] CI green on main branch

## Rollback Plan

Remove the `provider` property addition from the JSON schema. The only effect is the two tests will fail again — no runtime behavior is affected since the schema is only used in tests.

## Confidence

Very high. Single-property additive change to JSON schema that makes it match the existing TypeScript type. No logic changes. Cannot break any existing passing test.
