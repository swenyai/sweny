# Expanded Instruction Editor Modal

## Why this matters
Node instructions are the most important part of a workflow — they're multi-paragraph prompts that
determine what Claude does at each step. The current properties panel textarea is cramped (14 rows
in a narrow sidebar). Users need a full-screen or near-full-screen editor to comfortably write and
review long instructions, similar to how GitHub has an "expand" button on PR description fields.

## What to do

### 1. Create InstructionEditor component
Create `packages/studio/src/components/InstructionEditor.tsx` — a modal/overlay editor.

**Layout:**
- Overlays the canvas area (not the full viewport — keep toolbox and properties panel visible beneath for context)
- Or: a centered modal with `max-w-3xl` width and `max-h-[80vh]` height
- Header: node name + node ID (read-only context)
- Body: large `<textarea>` with monospace font, fills available space
- Footer: "Done" button (saves and closes), "Cancel" button (discards changes)
- Close on Escape key (same as Cancel)

**Behavior:**
- Opened via an "Expand" button (icon: arrows-expand or fullscreen icon) next to the Instruction label in PropertiesPanel
- On open: copies current instruction text into local state
- On "Done": calls `updateNode(id, { instruction })` and closes
- On "Cancel"/Escape: closes without saving
- Textarea auto-focuses on open

### 2. Add expand button to PropertiesPanel
- Next to the "Instruction" label, add a small icon button that opens InstructionEditor
- Use a simple expand/fullscreen SVG icon (two diagonal arrows)
- Only show in design mode (not read-only)

## Files to modify
- `packages/studio/src/components/InstructionEditor.tsx` (new)
- `packages/studio/src/components/PropertiesPanel.tsx` (add expand button)

## Acceptance criteria
- Clicking the expand icon opens a large modal editor for the node instruction
- Instruction text is preserved correctly on save
- Cancel/Escape discards unsaved changes
- Modal does not appear in read-only mode (simulate/live)
- `npm run build` passes in packages/studio
