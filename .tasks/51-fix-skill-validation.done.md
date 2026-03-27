# Task 51: Fix skill validation — don't warn about unconfigured skills

## Problem

When the triage workflow runs, the executor warns about every skill listed in any workflow node that isn't configured:

```
[warn] Workflow references unregistered skill: "sentry"
[warn] Workflow references unregistered skill: "datadog"
[warn] Workflow references unregistered skill: "betterstack"
[warn] Workflow references unregistered skill: "linear"
[warn] Workflow references unregistered skill: "slack"
[warn] Workflow references unregistered skill: "notification"
```

This is noisy and wrong. The triage workflow lists ALL possible skills per category (e.g. `["sentry", "datadog", "betterstack"]` for observability) because it's provider-agnostic. Only the configured ones should be used; the rest should be silently ignored.

## Root Cause

`packages/core/src/executor.ts`, `validate()` function (lines 216-233):

```typescript
const allSkillIds = new Set(Object.values(workflow.nodes).flatMap((n) => n.skills));
for (const id of allSkillIds) {
  if (!skills.has(id)) {
    consoleLogger.warn(`Workflow references unregistered skill: "${id}"`);
  }
}
```

It collects ALL skill IDs from ALL nodes and warns if any aren't in the registered skill map.

## Required Changes

1. **`packages/core/src/executor.ts`** — In `validate()`, remove the missing-skill warning loop entirely. The executor already handles missing skills gracefully in `resolveTools()` (line 120-125) — it filters out unregistered skills with `.filter((s): s is Skill => s != null)`. The warning adds no value.

2. **Add a smarter check**: After removing the blanket warning, add a check that each node has AT LEAST ONE registered skill from its list. If a node lists `["sentry", "datadog", "betterstack"]` and none are configured, THAT should be a warning (or error) — it means the node will run with zero tools.

## Acceptance Criteria

- No warnings for skills that are listed in a workflow but not configured (silent skip)
- Warning/error when a node has NO available skills (all listed skills are unconfigured)
- All existing tests pass
- Build succeeds

## Files to modify

- `packages/core/src/executor.ts` — `validate()` function
- `packages/core/src/executor.test.ts` — update/add tests for new validation behavior
