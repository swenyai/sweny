# Task 15 — Studio: Step ID rename

## Goal

Allow users to rename a step's ID directly in the PropertiesPanel. Step IDs are
currently displayed as read-only `<code>` blocks. Renaming must cascade all
references (transitions `next`, `on` targets, and `initial`) throughout the
definition.

## Context

- **PropertiesPanel**: `packages/studio/src/components/PropertiesPanel.tsx`
  Line 219–221: ID is shown as `<code>{id}</code>`. This is where the editable
  field goes.
- **editor-store**: `packages/studio/src/store/editor-store.ts`
  `updateStep(id, patch)` updates fields on a step but not the step's key.
  `deleteStep(id)` removes a step and fixes `initial`. You need a new
  `renameStep(oldId, newId)` action that:
  1. Validates `newId` is non-empty, valid identifier (regex `/^[a-zA-Z0-9_-]+$/`
     — same chars that YAML allows without quoting), and not already in use.
  2. Copies `def.steps[oldId]` to `def.steps[newId]`, deletes the old key.
  3. Updates `def.initial` if it was `oldId`.
  4. Rewrites every `step.next` and every `step.on[outcome]` that equals `oldId`
     to the new ID.
  5. Updates `selection.id` so the panel stays focused on the renamed step.
  6. Wrap in `produce` (immer) like all other store actions.
- **Validation errors** (do NOT call store if invalid):
  - Empty string → "Step ID cannot be empty"
  - Already exists → "A step with ID \"…\" already exists"
  - Invalid chars → "Step IDs may only contain letters, digits, hyphens, and underscores"
  - Same as current → no-op (silent)

## UI

In `StepPanel`, replace the `<code>{id}</code>` block with an editable `<input>`:

```tsx
const [editId, setEditId] = useState(id);

<input
  className={`w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono ${readOnly ? "opacity-60 cursor-not-allowed bg-gray-50" : ""}`}
  value={editId}
  disabled={readOnly}
  onChange={(e) => setEditId(e.target.value)}
  onBlur={() => {
    const trimmed = editId.trim();
    if (trimmed === id) return;           // no-op
    const err = renameStep(id, trimmed); // returns string | null
    if (err) {
      setEditId(id);                     // revert on error
      // optionally: show a transient error badge
    }
  }}
/>
```

`renameStep` should return the error message string on failure, or `null` on
success (so the UI can revert/display).

## Store return signature

```typescript
renameStep: (oldId: string, newId: string) => string | null;
```

## Changeset

Create `.changeset/studio-step-id-rename.md`:
```md
---
"@sweny-ai/studio": minor
---
Steps can now be renamed directly in the PropertiesPanel. Renaming cascades
all transition targets (`next`, `on`, `initial`) throughout the definition.
```

## Tests

No unit tests required for the store (the editor-store isn't covered by
unit tests today). Verify manually in the Studio UI:
1. Create a step "foo", rename it to "bar" → all next/on targets update.
2. Try a name that already exists → input reverts, no crash.
3. Rename the initial step → `def.initial` updates.

## Done when

- [ ] `renameStep` action added to editor-store
- [ ] PropertiesPanel shows editable ID input (read-only in non-design mode)
- [ ] Changeset created
- [ ] `npm test` passes in `packages/studio`
- [ ] `npx tsc --noEmit` passes in `packages/studio`
