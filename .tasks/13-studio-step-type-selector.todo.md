# Task 13 — Studio: Step type selector in StepPanel

## Goal

The `type` field (added in task 05) is the key way to wire a built-in
implementation to a YAML step — but the Studio's `StepPanel` has no UI for it.
Users must set `type` by editing YAML manually. Add a "Step type" dropdown to
`StepPanel` that lists all known built-in types (from `BUILTIN_STEP_TYPES` in
`step-types.ts`) plus a "— none (custom) —" option.

When a built-in type is selected, also auto-set `phase` to match the type's
default phase (since each built-in has a canonical phase). When type is cleared,
leave phase as-is.

## Background

**`BUILTIN_STEP_TYPES`**: `packages/studio/src/lib/step-types.ts` — array of
`{ type, label, description, phase, uses? }`. Already used in `Toolbar.tsx` for
the "Add step" dropdown. The `"custom"` entry (`type: "custom"`) is special — it
means no built-in type is assigned.

**`StepPanel`**: `packages/studio/src/components/PropertiesPanel.tsx` — the form
that appears on the right when a step node is selected. Currently has: phase
select, critical checkbox, description textarea, next select, transitions list.
The `type` field from the step definition is never displayed or edited.

**`updateStep`**: `useEditorStore().updateStep(stepId, partial)` — merges partial
update into the step definition. To set type: `updateStep(id, { type: "sweny/investigate" })`.
To clear: `updateStep(id, { type: undefined })`.

## What to build

### 1. Import `BUILTIN_STEP_TYPES` and `findStepType` in PropertiesPanel

```typescript
import { BUILTIN_STEP_TYPES, findStepType } from "../lib/step-types.js";
```

### 2. Add `type` select to `StepPanel` form

Place it **above** the phase select (since selecting a type auto-sets phase).

```tsx
{/* Step type */}
<div className="mb-3">
  <label className="block text-xs font-medium text-gray-600 mb-1">Step type</label>
  <select
    className={`w-full border border-gray-300 rounded px-2 py-1 text-sm ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
    value={step.type ?? ""}
    disabled={readOnly}
    onChange={(e) => {
      const selectedType = e.target.value;
      if (!selectedType) {
        updateStep(id, { type: undefined });
        return;
      }
      const entry = findStepType(selectedType);
      updateStep(id, {
        type: selectedType,
        ...(entry && entry.type !== "custom" ? { phase: entry.phase } : {}),
      });
    }}
  >
    <option value="">— none (custom) —</option>
    {BUILTIN_STEP_TYPES.filter((e) => e.type !== "custom").map((entry) => (
      <option key={entry.type} value={entry.type}>
        {entry.label}
      </option>
    ))}
  </select>
  {step.type && findStepType(step.type) && (
    <p className="text-xs text-gray-400 mt-1">{findStepType(step.type)!.description}</p>
  )}
</div>
```

The description hint below the dropdown gives the user a quick reminder of what
the step does without requiring them to look it up.

### 3. Keep `phase` select visible and editable

Even when a type is selected, keep the phase select enabled in design mode —
users may want to override the canonical phase for visual grouping purposes.
The auto-set behavior on type selection is a convenience, not a lock.

### 4. Update the `uses` display (optional but nice)

If the selected step type has a `uses` array, show the provider roles as read-
only badges below the type selector. This helps users know what providers must
be configured for the step to run. Example:

```tsx
{step.type && findStepType(step.type)?.uses && (
  <div className="flex flex-wrap gap-1 mt-1">
    {findStepType(step.type)!.uses!.map((role) => (
      <span key={role} className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
        {role}
      </span>
    ))}
  </div>
)}
```

### 5. Changeset

`.changeset/studio-step-type-selector.md`:
```md
---
"@sweny-ai/studio": minor
---

StepPanel now shows a "Step type" dropdown listing all built-in step types.
Selecting a type auto-sets the step's phase to the type's canonical phase and
shows the type's description as a hint. Selecting "none (custom)" clears the
type field.
```

## Files to touch

- `packages/studio/src/components/PropertiesPanel.tsx` — add type selector to `StepPanel`
- `.changeset/studio-step-type-selector.md` — new changeset

## Done criteria

- Clicking a step node in design mode shows a "Step type" dropdown
- Selecting a built-in type updates `step.type` and auto-sets `phase`
- Selecting "— none (custom) —" clears `step.type` (field becomes `undefined`)
- The type's description appears as a hint below the dropdown when a type is selected
- `uses` badges appear for types that declare them
- Dropdown is disabled in simulate/live mode (respects `readOnly`)
- `npm run typecheck --workspace packages/studio` clean
