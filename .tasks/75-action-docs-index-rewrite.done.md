# Task 75: Rewrite action/index.md for multi-repo architecture

## Problem

`packages/web/src/content/docs/action/index.md` describes the GitHub Action as if it's a monolithic triage action. But after the multi-repo split, the main repo (`swenyai/sweny@v5`) is a **generic workflow runner** that only accepts 6 inputs: `workflow`, `claude-oauth-token`, `anthropic-api-key`, `cli-version`, `node-version`, `working-directory`.

All triage-specific inputs (`observability-provider`, `sentry-*`, `dd-*`, `issue-tracker-provider`, `linear-*`, `dry-run`, etc.) now live on `swenyai/triage@v1`.

## What to change

### 1. Rewrite the intro (lines 1-8)

Current intro says "connects to observability platform, creates issues, writes fixes" which only applies to triage. Rewrite to cover the three-action architecture:
- `swenyai/sweny@v5` — generic runner (bring your own workflow YAML)
- `swenyai/triage@v1` — SRE triage preset (observability + issue tracker auto-wired)
- `swenyai/e2e@v1` — agentic browser tests

### 2. Replace the "Minimal setup" example (lines 20-48)

The current example uses `swenyai/sweny@v5` with `observability-provider: sentry` etc. Replace with **two examples**:

**Triage (most common)** — using `swenyai/triage@v1`:
```yaml
- uses: swenyai/triage@v1
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    observability-provider: sentry
    sentry-auth-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
    sentry-org: my-org
    sentry-project: my-project
```

**Custom workflow** — using `swenyai/sweny@v5`:
```yaml
- uses: swenyai/sweny@v5
  with:
    workflow: .sweny/workflows/my-workflow.yml
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

### 3. Fix "Switching observability providers" section (lines 103-116)

Change `swenyai/sweny@v5` to `swenyai/triage@v1`.

### 4. Fix "Using Linear or Jira" section (lines 118-140)

Change `swenyai/sweny@v5` to `swenyai/triage@v1`.

### 5. Fix "First run" dry-run example (lines 88-101)

Change `swenyai/sweny@v5` to `swenyai/triage@v1`.

### 6. Update "What is next" links

Add links to `swenyai/triage` and `swenyai/e2e` repos.

## Reference

- The actual `action.yml` at the repo root (read it to confirm inputs)
- `swenyai/triage` action.yml: has all observability/issue-tracker/notification/investigation inputs
- `swenyai/e2e` action.yml: has workflow, auth, base-url, agent-browser-version, screenshots inputs

## Validation

After editing, grep the file for `swenyai/sweny@v5` — every remaining instance should only appear alongside the `workflow:` input, never with triage-specific inputs like `observability-provider`, `sentry-*`, `dd-*`, etc.
