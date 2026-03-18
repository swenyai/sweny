# Task: Actionable Skip/+1 Messages in CLI Output

## Goal
When SWEny skips (no novel issues found) or adds a +1 to an existing issue, the CLI should output a suggestion that helps the user take the next step — rather than just printing a generic message and exiting.

## Problem
`formatNoActionResult()` in `packages/cli/src/output.ts` shows:
- Skip: `"No novel issues found"` — no hint that `--time-range 7d` or a different service might surface issues
- +1 Existing: `"Added occurrence to existing issue"` — no link to the issue that was incremented

This leads users to assume SWEny is broken or not finding things, causing churn.

## Files to Change

### `packages/cli/src/output.ts`

Find `formatNoActionResult()` (currently around line 271-293).

**Current shape (approximately):**
```typescript
export function formatNoActionResult(result: TriageResult, config: CliConfig): string {
  // ... shows recommendation, maybe issue link
}
```

**Changes:**
1. When recommendation includes `"skip"`:
   - Add a dimmed hint line: `  Tip: try --time-range 7d or --service-filter <service> to widen the search`
   - If `config.timeRange` is already set, omit the `--time-range` part of the hint
   - If `config.serviceFilter` is already set, omit the `--service-filter` part

2. When recommendation includes `"+1 existing"` and `data.issueUrl` is present:
   - Add a line: `  Issue updated: <issueUrl>`
   - If `data.issueIdentifier` is also present: `  Issue updated: ${data.issueIdentifier} — ${data.issueUrl}`

3. When `crossRepoData?.outcome === "dispatched"`:
   - Add a line: `  Dispatched to: ${crossRepoData.targetRepo}`

4. When `crossRepoData?.outcome === "dispatch-failed"`:
   - Add a warning line: `  Warning: dispatch to ${crossRepoData.targetRepo} failed — implementing locally`

The hint lines should use `chalk.dim(...)` to visually de-emphasize them vs the main status line.

## Context on `formatNoActionResult` inputs
The function receives a `TriageResult` (from `packages/engine/src/recipes/triage/types.ts`) and the CLI `CliConfig`. The result's step data is accessed via `result.steps` array — look at how the existing code calls `getStepData` or iterates steps in `output.ts` to understand the pattern.

## Tests to Add

File: `packages/cli/src/output.test.ts` (search for existing output tests).

```typescript
describe("formatNoActionResult actionable hints", () => {
  it("shows time-range hint when result is skip and no time range set", () => {
    const out = formatNoActionResult(makeSkipResult(), { timeRange: undefined } as CliConfig);
    expect(out).toContain("--time-range");
  });

  it("omits time-range hint when timeRange already set", () => {
    const out = formatNoActionResult(makeSkipResult(), { timeRange: "7d" } as CliConfig);
    expect(out).not.toContain("--time-range");
  });

  it("shows issue URL for +1 existing result", () => {
    const out = formatNoActionResult(makePlusOneResult("ENG-42", "https://linear.app/issue/ENG-42"), {} as CliConfig);
    expect(out).toContain("ENG-42");
    expect(out).toContain("https://linear.app/issue/ENG-42");
  });
});
```

Implement `makeSkipResult()` and `makePlusOneResult()` as minimal stub objects that satisfy the TypeScript types.

## Acceptance Criteria
- `sweny triage` with skip result shows: `Tip: try --time-range 7d or --service-filter <service> to widen the search`
- `sweny triage` with +1 result shows the issue URL
- Hints are visually dimmed (chalk.dim)
- Tests pass: `npm test` in `packages/cli`

## Changeset Required
File: `.changeset/actionable-skip-messages.md`
```md
---
"@sweny-ai/cli": patch
---

Skip and +1 results now include actionable hints — suggest widening search or show the updated issue URL.
```
