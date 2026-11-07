---
title: Inputs
description: Complete reference for the inputs of the SWEny GitHub Action (swenyai/sweny).
---

[`swenyai/sweny@v5`](https://github.com/swenyai/sweny) runs any SWEny workflow YAML. This table is checked against [`action.yml`](https://github.com/swenyai/sweny/blob/main/action.yml) in CI.

The separate [`swenyai/triage`](https://github.com/swenyai/triage#readme) and [`swenyai/e2e`](https://github.com/swenyai/e2e#readme) actions have their own inputs; see their READMEs.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `workflow` | Path to the workflow YAML file to execute (relative to working-directory). | Yes | -- |
| `claude-oauth-token` | Claude Code OAuth token. Use this OR anthropic-api-key. OAuth tokens do not consume API credit. | No | -- |
| `anthropic-api-key` | Anthropic API key for Claude (x-api-key). Use this OR claude-oauth-token. | No | -- |
| `anthropic-auth-token` | Bearer token (Authorization: Bearer) for gateways that expect it. Sets ANTHROPIC_AUTH_TOKEN. Distinct from anthropic-api-key (x-api-key). | No | -- |
| `anthropic-base-url` | Anthropic-compatible base URL (e.g. a LiteLLM gateway). Sets ANTHROPIC_BASE_URL. See docs: Using a model gateway. | No | -- |
| `sweny-auth` | Auth mode: auto (default), api-key, or oauth. Set 'api-key' to authenticate a gateway with anthropic-api-key / anthropic-auth-token even when an OAuth token is also present. | No | `auto` |
| `agent` | Coding agent that runs the nodes: claude (default) or codex. codex needs openai-api-key and installs the Codex CLI (@openai/codex). | No | `claude` |
| `openai-api-key` | OpenAI API key for agent: codex. Passed to Codex as CODEX_API_KEY. | No | -- |
| `codex-version` | Version of @openai/codex to install when agent is codex. Defaults to the version sweny's Codex capability claims were tested against (TESTED_CODEX_VERSION in harness/codex.ts). sweny needs 0.159.0 or newer; a newer Codex runs with a warning. Set 'latest' to opt in to untested versions. | No | `0.159.2` |
| `harness-policy` | strict refuses a node whose policy the agent cannot enforce (for example tools.deny: [write] on codex); warn runs it and reports it in the receipt. Empty uses the CLI default, which is strict under GitHub Actions. | No | -- |
| `cli-version` | Version of @sweny-ai/core to install (the package that ships the `sweny` CLI). On the v5 and v5.&lt;version&gt; tags this defaults to the exact core version that release was tested with; a branch ref such as @main defaults to latest. Set 'latest' to opt in to untested versions. | No | `latest` |
| `node-version` | Node.js version to install. | No | `24` |
| `working-directory` | Working directory to run the workflow from. Defaults to the repository root. | No | `.` |
| `setup-only` | When 'true', install and probe the agent and its sandbox, then stop without running the workflow or calling a model. For CI that proves a runner can host an agent. | No | `false` |
| `dry-run` | When 'true', run with read-only tools only: write tools, external MCP servers, and shell/file-edit tools are withheld, so nothing is created, posted, or sent (the PR comment and failure notification are skipped too). Stops at the first natural-language conditional edge. | No | `false` |
| `timeout` | Whole-run wall-clock budget in milliseconds, forwarded to `sweny workflow run --timeout`. Empty uses the CLI default (3600000 = 60 min). Use 0 for no wall-clock budget. | No | -- |
| `max-steps` | Hard cap on total node executions (including eval-failure retries), forwarded to `sweny workflow run --max-steps`. Empty uses the CLI default (200). | No | -- |
| `max-tokens` | Run-wide token budget (input plus output tokens), forwarded to `sweny workflow run --max-tokens` only when set. The lowest of this and the workflow's `budget.tokens` wins. A crossing stops the agent, fails the node, and halts the run. Fails the step on a CLI too old to enforce it, so a cap is never silently dropped. | No | -- |
| `max-cost` | Run-wide cost budget in US dollars, forwarded to `sweny workflow run --max-cost` only when set. Uses harness-reported cost (never estimated). The lowest of this and the workflow's `budget.cost_usd` wins. Fails the step on a CLI too old to enforce it. | No | -- |
| `verbose` | When 'true', print each tool call's input and output inline. Truncated for readability; use the CLI's --stream flag locally for full untruncated NDJSON. Helpful for debugging a node that halts or fails. | No | `false` |
| `show-output` | When 'true', print the workflow's final answer in the job log. Off by default: in CI the CLI prints only the path of the saved answer (.sweny/runs/&lt;run-id&gt;/output.md), because job logs are often readable by more people than the repo's secrets. The answer is redacted either way. Forwarded as `--show-output` only when set. | No | `false` |
| `input` | JSON object of per-run inputs for the workflow. Forwarded verbatim to `sweny workflow run --input '<json>'`. When the workflow declares an `inputs` block, the CLI validates this string against the declaration (type-check, required-field check, default-fill) and fails with a readable diff when the shape doesn't match. When the workflow does NOT declare `inputs`, the JSON is passed through unchanged for back-compat. | No | -- |
| `pr-comment` | Post or update one sticky comment on the pull request with the run receipt, a status-colored Mermaid DAG, and per-node status and duration. Metadata only: no prompts, tool inputs, or model output. Only acts on pull_request events (no-op on every other event). Uses the job's GITHUB_TOKEN, so the job needs `permissions: pull-requests: write` (fork PRs get a read-only token, so the post is skipped with a warning). A failed post warns and never fails the job. Set to 'false' to opt out. Requires an @sweny-ai/core version that supports `--comment-file`. | No | `true` |
| `notify-on-failure` | Tell someone when the run fails or is refused, and only then. Set to `issue` to open (or comment on) one sticky issue per workflow labelled `sweny-failure` (the job needs `permissions: issues: write`), or to a Slack incoming-webhook: pass the URL from a secret, or the NAME of an env var on this step that holds it (for example SLACK_WEBHOOK_URL). Metadata only: workflow id, failed node ids, a reason class (node_failed, crashed, did_not_start), and the run link. Never error text or model output. A failed notification warns and never fails the job. Empty (the default) sends nothing. Needs no CLI support. | No | -- |
| `cloud-token` | Project token (sweny_pk_...) enabling opt-in run reporting. Optional, and not currently available. Token minting is not yet exposed, so leaving this unset (the default) means no outbound reporting request is made. Equivalent to setting the SWENY_CLOUD_TOKEN env var; either form is accepted. | No | -- |

With `agent: claude` you must provide either `claude-oauth-token` or `anthropic-api-key`; with `agent: codex`, `openai-api-key`.

#### PR comment

The comment needs `pull-requests: write` on the job's `GITHUB_TOKEN`. Grant it only when `pr-comment` is enabled:

```yaml
permissions:
  contents: read
  pull-requests: write
```

The comment is created once and updated in place on later runs (found by a hidden `<!-- sweny-run-comment:<workflow-id> -->` marker). If posting fails (for example a fork PR with a read-only token), the step warns and the job is unaffected. Needs a `@sweny-ai/core` version with `--comment-file`.

On other CI systems, run `sweny workflow run <file> --comment-file comment.md` and post the file with your runner's API.

Pass any additional credentials your workflow needs via `env:` on the step — the CLI auto-loads environment variables.
