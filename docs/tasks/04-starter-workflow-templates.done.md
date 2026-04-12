# Task 04: Starter Workflow Templates for `sweny init`

## Goal
Add 3-5 starter workflow templates that `sweny init` offers during setup. Each template should work out of the box with zero config beyond provider credentials.

## Context
- `sweny init` is at `packages/core/src/cli/init.ts` — uses `@clack/prompts`
- Currently generates `.sweny.yml`, `.env`, and optionally `.github/workflows/sweny-triage.yml`
- The init wizard already asks about providers — we can use those selections to suggest relevant templates
- Templates should be real, working workflow YAML files
- There's already an `examples/file-ops.yml` but it's a toy example

## Proposed Templates

### 1. `pr-review` — PR Review Bot
- Triggered on PR open
- Nodes: fetch-diff → review-code → post-comment
- Skills: github
- Works with just a GitHub token

### 2. `issue-triage` — Issue Triage
- Triggered on new issue
- Nodes: classify → assign-priority → add-labels → (optional) auto-implement
- Skills: github, (optional linear/jira)
- Works with just a GitHub token

### 3. `security-scan` — Security Audit
- Triggered on PR or schedule
- Nodes: scan-deps → scan-code → generate-report
- Skills: github
- Works with just a GitHub token

### 4. `release-notes` — Release Notes Generator
- Triggered on tag push
- Nodes: gather-commits → categorize → write-notes → create-release
- Skills: github
- Works with just a GitHub token

### 5. `custom` — Blank Template
- Minimal skeleton with one node
- User fills in their own workflow
- Good for advanced users

## Implementation

### 1. Create template files
Put them in `packages/core/src/cli/templates/` as `.yml` files or inline them in a TypeScript module.

Recommendation: Use a TypeScript module (`packages/core/src/cli/templates.ts`) that exports template objects with metadata + YAML content. This avoids file-system reads at runtime and works when installed from npm.

```typescript
interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  yaml: string;
}
```

### 2. Modify `sweny init` to offer template selection
In `packages/core/src/cli/init.ts`, after the existing wizard flow:
- Add a step: "Would you like to start with a workflow template?"
- If yes, show `p.select()` with template options
- Write selected template to `.sweny/workflows/<template-id>.yml` or the project root

### 3. Write the template file
- Write the YAML to the appropriate location
- Show the user what was created and how to run it

## Files to Create/Modify
- Create: `packages/core/src/cli/templates.ts` — template definitions
- Modify: `packages/core/src/cli/init.ts` — add template selection step
- Create: test for template selection flow

## Acceptance Criteria
- [ ] At least 4 workflow templates defined
- [ ] `sweny init` offers template selection after setup
- [ ] Selected template is written to disk
- [ ] Each template is valid (passes `parseWorkflow` + `validateWorkflow`)
- [ ] Templates work with minimal credentials (GitHub token only for most)
- [ ] Tests cover template selection flow
