# Task 06: Studio — Workflow GUI (Node Picker + YAML Export + Fork UX)

## Context

Studio is a visual DAG editor for workflows (`@sweny-ai/studio`). Currently it:
- Lets users add nodes by typing an ID and selecting a phase
- Exports TypeScript stubs (not useful for declarative workflows)
- Has no awareness of built-in step types

**Goal:** Make Studio the GUI for declarative YAML workflows.

After Task 05, `StepDefinition.type` exists and `resolveWorkflow()` works.
Studio should let users design workflows visually and export them as YAML that can be run with `sweny workflow run`.

---

## Part 1 — Step Type Picker (Node Picker)

### New data: built-in step type catalog

Add a static catalog of built-in step types to `packages/studio/src/lib/step-types.ts` (new file):

```ts
export interface StepTypeEntry {
  type: string;         // "sweny/fetch-issue"
  label: string;        // "Fetch Issue"
  description: string;  // "Fetch issue details from the issue tracker"
  phase: WorkflowPhase; // default phase suggestion
  uses?: string[];      // default provider roles
}

export const BUILTIN_STEP_TYPES: StepTypeEntry[] = [
  { type: "sweny/verify-access",   label: "Verify Access",    description: "Verify all required provider credentials", phase: "learn" },
  { type: "sweny/build-context",   label: "Build Context",    description: "Gather logs and context from observability", phase: "learn", uses: ["observability"] },
  { type: "sweny/investigate",     label: "Investigate",      description: "Run agent to investigate root cause", phase: "learn", uses: ["codingAgent"] },
  { type: "sweny/novelty-gate",    label: "Novelty Gate",     description: "Check if issue is novel or duplicate", phase: "act", uses: ["issueTracker"] },
  { type: "sweny/create-issue",    label: "Create Issue",     description: "Create a ticket in the issue tracker", phase: "act", uses: ["issueTracker"] },
  { type: "sweny/fetch-issue",     label: "Fetch Issue",      description: "Fetch issue details from the issue tracker", phase: "learn", uses: ["issueTracker"] },
  { type: "sweny/implement-fix",   label: "Implement Fix",    description: "Run agent to implement the fix", phase: "act", uses: ["codingAgent"] },
  { type: "sweny/create-pr",       label: "Create PR",        description: "Create a pull request", phase: "act", uses: ["sourceControl"] },
  { type: "sweny/cross-repo-check",label: "Cross-Repo Check", description: "Check if fix should be in another repo", phase: "act", uses: ["sourceControl"] },
  { type: "sweny/dedup-check",     label: "Dedup Check",      description: "Check for duplicate events (idempotency)", phase: "learn", uses: ["observability"] },
  { type: "sweny/notify",          label: "Notify",           description: "Send notification (Slack, email, etc.)", phase: "report", uses: ["notification"] },
  { type: "custom",                label: "Custom Step",      description: "Custom step — implement in code", phase: "act" },
];
```

### Update `Toolbar.tsx` — "Add Step" flow

Replace the current "type an ID, pick a phase" flow with:

1. Click "Add Step" → opens a step type picker dropdown/modal
2. User selects a type from `BUILTIN_STEP_TYPES` (grouped by phase)
3. User gives the step an ID (pre-filled from the type label, e.g. "investigate")
4. Studio adds the node with `type`, `phase`, and `uses` pre-populated from the catalog entry

The picker should show: type name, label, description, phase badge, uses tags.

### Update `StepDefinition` rendering in `StateNode.tsx`

Show the step `type` (e.g. "sweny/investigate") as a subtitle below the step ID. If no type, show "custom".

### Update `PropertiesPanel.tsx`

In the step properties panel:
- Show `type` field (read-only display when set, or dropdown to change it)
- Show `uses` as tags (read-only — derived from the type catalog)
- When user changes `type`, auto-update `uses` and `phase` from catalog

---

## Part 2 — YAML Export (Primary Export)

### Update `Toolbar.tsx`

Change "Export JSON" to "Export YAML" as the primary action. Keep "Export JSON" as a secondary option.

### New `packages/studio/src/lib/export-yaml.ts`

```ts
import { stringify } from "yaml";
import type { WorkflowDefinition } from "@sweny-ai/engine";

export function exportWorkflowYaml(definition: WorkflowDefinition): string {
  return stringify(definition, {
    indent: 2,
    lineWidth: 120,
  });
}
```

Add `yaml` to `packages/studio/package.json` dependencies.

### Update export filename

`Toolbar.tsx`: when downloading, use `${definition.id}.workflow.yaml` instead of `${definition.id}.recipe.json`.

---

## Part 3 — Fork UX

### "Fork this workflow" button in App.tsx

When Studio loads with a built-in workflow (triage or implement preset), show a "Fork" button in the toolbar.

Clicking Fork:
1. Duplicates the definition
2. Changes `id` to `${original-id}-fork`
3. Changes `name` to `${original-name} (Fork)`
4. Drops user into design mode with full edit capability
5. Shows a toast: "Forked! Customize your workflow then export as YAML."

### Permalink encodes the full definition

This already works (URL hash encodes the definition). After forking, the URL updates so the fork is shareable immediately.

### Import from YAML

Update `ImportModal.tsx`:
- Accept both JSON and YAML paste
- Detect format: if input starts with `id:` or contains `steps:` without `{`, try YAML parse first
- Show placeholder: "Paste workflow YAML or JSON..."

Parse YAML in import:
```ts
import { parse as parseYaml } from "yaml";

function parseInput(raw: string): WorkflowDefinition {
  try {
    return JSON.parse(raw);
  } catch {
    return parseYaml(raw) as WorkflowDefinition;
  }
}
```

---

## Part 4 — Simulation Mode Update

### `SimulationPanel.tsx`

After Task 01, `createWorkflow`/`runWorkflow` are already wired in. But for declarative workflows (steps with `type` field), simulation should use `resolveWorkflow()` instead of requiring implementations.

Update simulation:
- If all steps have a `type` field: use `resolveWorkflow()` (hooks up real implementations, but runs against mock providers — same latch-stepping pattern)
- If any steps are `custom`: fall back to current mock stub pattern

---

## Part 5 — Studio Presets

In `App.tsx`, where built-in recipes are shown as presets, update labels to match workflow terminology and add YAML export hint.

---

## Changeset

`.changeset/studio-workflow-gui.md`:
```md
---
"@sweny-ai/studio": minor
---

Studio is now the GUI for declarative YAML workflows.

- **Step type picker**: select built-in step types (sweny/investigate, sweny/create-pr, etc.) when adding nodes — pre-populates phase, uses, and type fields
- **YAML export**: primary export is now workflow YAML (compatible with `sweny workflow run`)
- **YAML import**: Import modal accepts YAML or JSON
- **Fork UX**: one-click fork of built-in workflows (triage, implement) into editable custom workflow
- **Step type display**: nodes show their type identifier as subtitle
```

---

## Done Criteria

- [ ] "Add Step" shows type picker with all built-in step types
- [ ] Step nodes show `type` field as subtitle
- [ ] "Export YAML" is the primary export action in the toolbar
- [ ] Exported YAML is valid and runnable with `sweny workflow run`
- [ ] "Fork" button appears on built-in preset workflows
- [ ] Import modal accepts YAML paste
- [ ] `npm run build:lib` passes for studio library build
- [ ] `npm run build` passes for studio SPA
- [ ] Changeset created
