# Task 08 — PropertiesPanel: execution view in simulate/live mode

## Goal

When Studio is in **simulate** or **live** mode and the user clicks a completed
step node, the right-side PropertiesPanel should show that step's execution
result instead of the design-time fields. This makes the trace panel and the
graph work together for debugging.

## Background

**Store fields** (all already in `packages/studio/src/store/editor-store.ts`):
- `mode: StudioMode` — `"design" | "simulate" | "live"`
- `selection: Selection | null` — `{ kind: "step"; id: string } | { kind: "edge"; ... } | null`
- `completedSteps: Record<string, StepResult>` — keyed by step id
- `currentStepId: string | null` — step currently executing

**StepResult** (from `@sweny-ai/engine`):
```typescript
interface StepResult {
  status: "success" | "skipped" | "failed";
  data?: Record<string, unknown>;
  reason?: string;
  cached?: boolean;
}
```

**PropertiesPanel** is at `packages/studio/src/components/PropertiesPanel.tsx`.
It currently always shows design-time fields (phase selector, transitions, type
field, uses list, etc.) regardless of mode.

## What to build

### 1. Add an execution result section to PropertiesPanel

At the **top** of the PropertiesPanel's step view, when `mode !== "design"`,
render an execution result card if the selected step has a result in
`completedSteps`. If the step is the current one (running now), show a
"running…" indicator. Otherwise in simulate/live with no result yet, show
"pending" in muted text.

The design-time editing controls (phase selector, transitions form, etc.)
should remain visible below the execution result card but be **read-only** in
simulate and live modes (disable inputs; you can't edit during execution).

### 2. ExecutionResultCard component (inline or extracted)

Keep it simple — a small card inside PropertiesPanel:

```
┌─ Execution Result ──────────────────────┐
│ ✓ success                               │  ← colored by status
│ outcome: implement                       │  ← if data.outcome set
│ reason: No novel issue found             │  ← if reason set
│                                          │
│ ▸ Full output data  (expandable)         │  ← if data has more keys
│   { "recommendation": "implement", ... } │
└──────────────────────────────────────────┘
```

Status coloring:
- `success` → green
- `failed` → red
- `skipped` → gray
- `currentStepId` (running) → blue pulsing

Full output data section:
- Only shown when `result.data` has keys beyond just `outcome`
- Use `<pre>` with `JSON.stringify(result.data, null, 2)` truncated to 400 chars

### 3. Read-only editing controls in simulate/live

Pass `readOnly={mode !== "design"}` down through the panel's sub-sections. For
each input / select / textarea, add `disabled={readOnly}` and
`className="... opacity-60 cursor-not-allowed"` when disabled. Do not hide
controls — the user should still be able to read the workflow definition while
watching execution.

### 4. Tests

`packages/studio` does not have unit tests (it's a visual tool). No new tests
required. Verify manually that:
- Clicking a completed node in simulate mode shows the result card
- Clicking an unrun node shows "pending"
- Clicking the currently-running node shows "running…"
- All design controls are visually disabled (not hidden) in simulate/live

### 5. Changeset

Create `.changeset/properties-panel-execution-view.md`:

```md
---
"@sweny-ai/studio": minor
---

PropertiesPanel now shows execution results in simulate/live mode.
Clicking a completed step displays status, outcome badge, reason, and
optionally the full output data. Design controls become read-only during
execution so the workflow definition stays visible.
```

## Files to touch

- `packages/studio/src/components/PropertiesPanel.tsx` — main change
- `packages/studio/src/store/editor-store.ts` — read-only (no changes needed, just read)
- `.changeset/properties-panel-execution-view.md` — new changeset

## Done criteria

- Clicking a completed step in simulate mode shows a result card at top of panel
- Running step shows pulsing "running…" indicator
- Unrun step shows "pending" in muted text
- Design controls are disabled (not hidden) in simulate/live mode
- `npm run typecheck --workspace packages/studio` passes
