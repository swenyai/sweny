# Task 54: Support additional context/rules documents

## Problem

Teams have SDLC documents, coding standards, operational runbooks, and other reference material that should inform how SWEny triages issues and creates fixes. Currently there's no way to provide this context — SWEny operates with only its built-in workflow instructions.

## Goal

Allow users to provide additional context documents that get injected into Claude's system context during workflow execution. These documents provide rules, standards, and domain knowledge that shape SWEny's behavior.

## Design

### Configuration

```yaml
# .sweny.yml
additional-context:
  - .github/SDLC.md
  - .github/coding-standards.md
  - https://linear.app/team/docs/incident-response-playbook
```

Or via action input:

```yaml
# GitHub Action workflow
- uses: swenyai/sweny@v4
  with:
    additional-context: |
      .github/SDLC.md
      .github/coding-standards.md
```

### How it works

1. At workflow start, load all context documents (local files or URLs)
2. Concatenate them into a single `additionalContext` string
3. Pass as part of workflow input
4. The executor prepends this context to every node's instruction:

```
## Additional Context & Rules

<contents of user-provided documents>

## Instruction

<node's original instruction>
```

This way every node (gather, investigate, create_issue, notify) has access to the team's standards.

### Implementation

1. **Context loading** (`packages/core/src/templates.ts` — extend from task 53):
   - Add `loadAdditionalContext(sources: string[], cwd: string): Promise<string>`
   - Each source is loaded (file or URL), wrapped with a header (`### <filename>`), and concatenated

2. **Executor injection** (`packages/core/src/executor.ts`):
   - Check for `additionalContext` in the execution input
   - If present, prepend to each node's instruction before passing to Claude

3. **Config** (`.sweny.yml`, action inputs, CLI):
   - `.sweny.yml`: `additional-context` key (array of paths/URLs)
   - `action.yml`: `additional-context` input (newline-separated paths/URLs)
   - CLI: `--context` flag (comma-separated or repeated)

## Acceptance Criteria

- Local markdown files are loaded and injected into every node's context
- URLs are fetched and injected
- Missing files produce a warning but don't fail the workflow
- Context is visible in streaming logs (e.g. "Loaded 3 context documents")
- Action input, CLI flag, and `.sweny.yml` all work
- All existing tests pass
- Build succeeds

## Files to create/modify

- `packages/core/src/templates.ts` — add context loading (extend from task 53)
- `packages/core/src/executor.ts` — inject additional context into node instructions
- `packages/core/src/cli/config.ts` — add `additionalContext` config field
- `packages/core/src/cli/main.ts` — load and pass context
- `packages/action/src/config.ts` — parse additional-context input
- `packages/action/src/main.ts` — load and pass context
- `action.yml` — add `additional-context` input
- `packages/core/src/types.ts` — add `additionalContext` to ExecuteOptions if needed

## Dependency

This task depends on task 53 (templates) since it extends the same template loading infrastructure.
