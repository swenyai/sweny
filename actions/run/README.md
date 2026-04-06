# SWEny — Run Workflow Action

Generic GitHub Action for running any [SWEny](https://sweny.ai) workflow YAML on GitHub Actions.

This action is a thin wrapper around the `sweny` CLI: it installs Node.js, installs `@sweny-ai/core` (which ships the `sweny` binary), and executes your workflow file. Bring your own workflow.

For built-in triage / implement workflows with all the observability and source-control provider integrations pre-wired, use the root `swenyai/sweny@v4` action instead.

## Usage

```yaml
- uses: swenyai/sweny/actions/run@v5
  with:
    workflow: .sweny/workflows/my-workflow.yml
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
  env:
    # Pass any env vars your workflow needs
    MY_API_TOKEN: ${{ secrets.MY_API_TOKEN }}
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `workflow` | yes | — | Path to the workflow YAML file (relative to `working-directory`). |
| `claude-oauth-token` | one of these | — | Claude Code OAuth token. Does not consume API credit. |
| `anthropic-api-key` | one of these | — | Anthropic API key for Claude. |
| `cli-version` | no | `latest` | Version of `@sweny-ai/core` to install. |
| `node-version` | no | `24` | Node.js version. |
| `working-directory` | no | `.` | Working directory to run the workflow from. |

You must provide either `claude-oauth-token` or `anthropic-api-key`.

## Passing env vars to your workflow

Anything you set in the calling job's `env:` block (or step `env:`) is visible to the workflow nodes — `sweny` runs in the same shell environment. Use this to pass secrets, base URLs, feature flags, etc.

```yaml
- uses: swenyai/sweny/actions/run@v5
  with:
    workflow: .sweny/workflows/release-notes.yml
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
  env:
    LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
    SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
```

## See also

- [`actions/e2e`](../e2e) — preset for E2E test workflows (installs `agent-browser`, uploads screenshots).
- Root [`swenyai/sweny`](../..) action — built-in triage and implement workflows.
