# Task 80: Fix landing page and quick-start action examples

## Problem

Two high-visibility pages show `swenyai/sweny@v5` with triage-specific inputs:

1. `packages/web/src/content/docs/index.mdx` (line 139) — "Run it on a schedule" section shows `swenyai/sweny@v5` with `observability-provider: sentry` and `sentry-auth-token`
2. `packages/web/src/content/docs/getting-started/quick-start.md` (line 80) — GitHub Action surface shows `swenyai/sweny@v5` with `observability-provider: sentry` and `sentry-*` inputs

## What to change

### index.mdx — "Run it on a schedule" section (~line 136-146)

Change the YAML example from:
```yaml
- uses: swenyai/sweny@v5
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    observability-provider: sentry
    sentry-auth-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
```

To:
```yaml
- uses: swenyai/triage@v1
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    observability-provider: sentry
    sentry-auth-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
```

Update surrounding text to mention that this is the triage preset action.

### quick-start.md — GitHub Action surface (~line 78-87)

Same fix: change `swenyai/sweny@v5` to `swenyai/triage@v1` in the triage example. Consider also adding a brief note about `swenyai/sweny@v5` being the generic runner and `swenyai/e2e@v1` for browser tests.

## Files

- `packages/web/src/content/docs/index.mdx`
- `packages/web/src/content/docs/getting-started/quick-start.md`

## Validation

After editing, these files should not show `swenyai/sweny@v5` with any triage-specific inputs (observability-provider, sentry-*, dd-*, etc.).
