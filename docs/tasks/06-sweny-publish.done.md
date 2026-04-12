# Task 06: `sweny publish` — Interactive CLI for Publishing Workflows & Skills

## Goal
Add a `sweny publish` command that lets users publish both workflows and custom skills to the SWEny marketplace via an interactive CLI.

## Context
- CLI is in `packages/core/src/cli/main.ts` — uses `commander` + `@clack/prompts`
- Marketplace accepts contributions via PR to `workflows/community/` (see marketplace CONTRIBUTING.md)
- The marketplace has a validation script at `scripts/validate.mjs`
- Skills follow the SKILL.md format (see `packages/web/src/content/docs/skills/custom.md`)
- The command should be `sweny publish` (not `sweny publish-skill`) — it handles both types

## Design

### Interactive Flow
```
$ sweny publish

? What would you like to publish?
  ○ Workflow (.yml file)
  ○ Skill (SKILL.md directory)

[If Workflow selected:]
? Path to workflow file: ./my-workflow.yml
  ✓ Validated: 3 nodes, 2 edges, all skills resolved
? Author name: your-name
? Category: [select from list]
? Tags (comma-separated): automation, testing
  ✓ Generated metadata
  
? How would you like to publish?
  ○ Open GitHub PR (recommended)
  ○ Copy to clipboard (for manual submission)
  ○ Save submission file locally

[If Skill selected:]
? Path to skill directory: .sweny/skills/my-skill/
  ✓ Validated: SKILL.md found, frontmatter valid
? How would you like to publish?
  ○ Open GitHub PR (recommended)  
  ○ Copy to clipboard
  ○ Save submission file locally
```

### GitHub PR Flow
When "Open GitHub PR" is selected:
1. Fork `swenyai/marketplace` (if not already forked) via `gh` CLI
2. Create branch with skill/workflow name
3. Copy file(s) to appropriate directory
4. Commit and push
5. Open PR with auto-generated description
6. Print PR URL

Fallback: if `gh` is not installed, fall back to "Copy to clipboard" with instructions.

## Implementation

### 1. Create `packages/core/src/cli/publish.ts`
- `registerPublishCommand(program)` — follows the pattern in `setup.ts`
- Interactive flow using `@clack/prompts`
- Validates workflow via `parseWorkflow` + `validateWorkflow` from `../schema`
- Validates skill via SKILL.md frontmatter parsing
- Handles the three output modes

### 2. Register in `main.ts`
```typescript
import { registerPublishCommand } from "./publish.js";
registerPublishCommand(program);
```

### 3. Workflow validation
- Parse YAML → `parseWorkflow()` → `validateWorkflow()`
- Check for required marketplace metadata: author, category, tags
- Prompt for missing metadata interactively

### 4. Skill validation
- Check SKILL.md exists in directory
- Parse frontmatter — verify name, description
- Validate against VALID_SKILL_ID regex

### 5. GitHub PR mode
- Check `gh` CLI available: `execSync("gh --version")`
- Use `gh repo fork swenyai/marketplace --clone=false`
- Use `gh` commands to create branch, copy files, commit, push, create PR
- Fallback gracefully if `gh` not available

## Files to Create/Modify
- Create: `packages/core/src/cli/publish.ts`
- Modify: `packages/core/src/cli/main.ts` — register command
- Create: `packages/core/src/__tests__/publish.test.ts` — test validation and flow logic

## Acceptance Criteria
- [ ] `sweny publish` command registered and shows in help
- [ ] Interactive selection between workflow and skill
- [ ] Workflow validation using core schema
- [ ] Skill validation using SKILL.md format
- [ ] Metadata collection via interactive prompts
- [ ] At least "save locally" mode works without external deps
- [ ] GitHub PR mode attempts `gh` and falls back gracefully
- [ ] Tests cover validation and prompt flow
