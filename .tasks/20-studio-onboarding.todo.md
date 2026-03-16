# Task 20 — Studio: first-time user experience

## Goal

When Studio first loads, a new user sees the triage workflow with no guidance.
They don't know: what they're looking at, what they can do, how to create their
own workflow, or how to use Simulate mode. This task adds two lightweight
onboarding improvements:

1. **Keyboard shortcut help panel** (`?` key or `⌘?` button) — a small
   overlay listing the shortcuts already in the app.
2. **Empty-state hint for blank canvas** — if a user clears all steps,
   show a helpful message instead of an empty gray box.

## Context

- **`packages/studio/src/App.tsx`** — handles keyboard shortcuts (Cmd+Z, Cmd+O,
  Escape, Backspace, etc). The shortcut list already exists in code but is not
  surfaced to the user.
- **`packages/studio/src/components/Toolbar.tsx`** — add a `?` button on the
  far right that toggles the help panel.
- **Canvas area** — when `Object.keys(definition.steps).length === 0`, show an
  empty state with a "Add your first step ↑" message.

## Keyboard shortcuts to document

| Shortcut | Action |
|---|---|
| `Cmd+Z` | Undo |
| `Cmd+Shift+Z` | Redo |
| `Cmd+O` | Import workflow |
| `Backspace` / `Delete` | Delete selected step |
| `Escape` | Deselect |

## Implementation

### Help panel component

`packages/studio/src/components/HelpPanel.tsx`:
```tsx
interface HelpPanelProps { onClose(): void; }
export function HelpPanel({ onClose }: HelpPanelProps) { ... }
```

Small centered modal (or side panel) with a table of shortcuts and a brief
"What is Studio?" blurb:
> "Studio lets you design, simulate, and monitor SWEny workflows. Design mode:
> edit steps and transitions. Simulate mode: run the workflow locally. Live mode:
> connect to a running engine instance."

Close on Escape or clicking outside.

### Toolbar changes

Add a `?` button to the far right of the Toolbar (after "Share link"):
```tsx
<button onClick={() => setShowHelp(true)} className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs" title="Keyboard shortcuts (?)">
  ?
</button>
```

Pass `showHelp` / `onShowHelpChange` as props (same pattern as `showImport`).

### Empty state

In the canvas area (wherever the ReactFlow graph renders), wrap in a check:
```tsx
{Object.keys(definition.steps).length === 0 && (
  <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm pointer-events-none">
    <p>No steps yet. Add your first step using the toolbar above.</p>
  </div>
)}
```

Find the canvas container in `packages/studio/src/App.tsx` or wherever
`<ReactFlow ...>` is rendered and add this overlay.

## Changeset

Create `.changeset/studio-onboarding.md`:
```md
---
"@sweny-ai/studio": patch
---
Added a keyboard shortcut help panel (? button in toolbar) and an empty-state
message when no steps are defined.
```

## Done when

- [ ] `HelpPanel.tsx` component created with shortcut table
- [ ] `?` button in Toolbar opens the panel
- [ ] Panel closes on Escape or click-outside
- [ ] Empty-state message shown when steps object is empty
- [ ] Changeset created
- [ ] `npx tsc --noEmit` passes
