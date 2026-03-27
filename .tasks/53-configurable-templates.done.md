# Task 53: Add configurable templates for issues and PRs

## Problem

SWEny creates issues and PRs with whatever format Claude chooses. There's no way for users to provide their own templates — for example, a team's SDLC issue template, a PR template from their repo, or formatting standards from a Linear document.

## Goal

Support user-provided templates that guide how SWEny formats issues and PRs. Templates should be:
- **Optional** — sensible defaults when no template is configured
- **Flexible source** — local file path, URL (e.g. GitHub wiki, Linear doc), or inline raw markdown
- **Injected into workflow instructions** — the template content becomes part of the node instruction so Claude follows it

## Design

### Configuration (`.sweny.yml` or action inputs)

Add new config fields:

```yaml
# .sweny.yml
issue-template: .github/ISSUE_TEMPLATE/bug_report.md
pr-template: .github/pull_request_template.md
```

Or via action inputs:

```yaml
# GitHub Action workflow
- uses: swenyai/sweny@v4
  with:
    issue-template: .github/ISSUE_TEMPLATE/bug_report.md
    pr-template: .github/pull_request_template.md
```

Template sources (resolved in order):
1. **Local file path** — relative to repo root (e.g. `.github/ISSUE_TEMPLATE/bug_report.md`)
2. **URL** — fetched at runtime (e.g. `https://linear.app/docs/...` or GitHub raw URL)
3. **Inline** — raw markdown string directly in config (for simple cases)

### Default Templates

When no template is configured, use built-in defaults that follow industry standards:

**Default issue template** (built-in):
```markdown
## Summary
<!-- One-line description of the issue -->

## Root Cause
<!-- What caused this issue -->

## Impact
- **Severity**: <!-- critical/high/medium/low -->
- **Affected Services**: <!-- list -->
- **User Impact**: <!-- description -->

## Steps to Reproduce
1. ...

## Recommended Fix
<!-- Proposed solution -->

## Related
- Commits: <!-- relevant commits -->
- PRs: <!-- related PRs -->
```

**Default PR template** (built-in):
```markdown
## Summary
<!-- What does this PR do? -->

## Root Cause
<!-- What caused the issue this fixes? -->

## Changes
<!-- Bullet list of changes -->

## Testing
- [ ] Tested locally
- [ ] No breaking changes

## Related Issues
Fixes #
```

### Implementation

1. **Template loading** (`packages/core/src/templates.ts` — new file):
   - `loadTemplate(source: string, cwd: string): Promise<string>` — resolves local path, URL, or inline
   - `DEFAULT_ISSUE_TEMPLATE` and `DEFAULT_PR_TEMPLATE` constants
   - Export a `resolveTemplates(config)` function that returns `{ issueTemplate: string, prTemplate: string }`

2. **Inject into workflow input** (`packages/action/src/main.ts` and `packages/core/src/cli/main.ts`):
   - Load templates during setup
   - Pass them as part of the workflow input: `{ ...input, issueTemplate, prTemplate }`

3. **Reference in workflow instructions** (`packages/core/src/workflows/triage.ts`):
   - Update `create_issue` node instruction to reference the template from context:
     ```
     Format the issue body according to the issue template provided in context.issueTemplate.
     If no template is provided, use a clear structure with: Summary, Root Cause, Impact, Steps to Reproduce, and Recommended Fix.
     ```

4. **Action inputs** (`action.yml`):
   - Add `issue-template` and `pr-template` inputs (optional, no default)

5. **CLI config** (`packages/core/src/cli/config.ts`):
   - Add `issueTemplate` and `prTemplate` to `CliConfig`
   - Support via `.sweny.yml` keys `issue-template` and `pr-template`

### Config file loading (`packages/core/src/cli/config-file.ts`)

The existing `loadConfigFile()` already parses `.sweny.yml` key-value pairs. Template paths will be resolved relative to the repo root.

## Acceptance Criteria

- Default templates produce well-structured issues/PRs without any config
- Custom templates (local file) are loaded and injected into workflow context
- Custom templates (URL) are fetched and injected
- If template file/URL is missing, fall back to defaults with a warning
- Action inputs `issue-template` and `pr-template` work
- `.sweny.yml` keys `issue-template` and `pr-template` work
- All existing tests pass
- Build succeeds

## Files to create/modify

- `packages/core/src/templates.ts` — NEW: template loading + defaults
- `packages/core/src/workflows/triage.ts` — reference templates in create_issue instruction
- `packages/core/src/workflows/implement.ts` — reference templates in PR creation instruction
- `packages/core/src/cli/config.ts` — add template config fields
- `packages/core/src/cli/main.ts` — load and pass templates
- `packages/action/src/main.ts` — load and pass templates
- `packages/action/src/config.ts` — parse template inputs
- `action.yml` — add template input definitions
- `packages/core/src/index.ts` — export template utilities
