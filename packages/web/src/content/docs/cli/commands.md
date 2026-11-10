---
title: Commands Reference
description: Full reference for every SWEny CLI command, flag, and option.
---

The `sweny` binary is provided by the `@sweny-ai/core` package. All commands auto-load `.env` and search upward for `.sweny.yml` before parsing flags.

## sweny new

Create a new SWEny workflow. Interactive picker offering templates, AI-generated workflows, end-to-end browser testing, or a blank start. `sweny new` is the single entry for all workflow creation.

```bash
sweny new          # interactive picker
sweny new e2e      # jump straight into the end-to-end browser-testing wizard
sweny new <id>     # use a built-in template by id, or a workflow from the marketplace
```

An id that is not a built-in template is installed from [swenyai/marketplace](https://github.com/swenyai/marketplace) (`workflows/official/<id>.yml`, then `workflows/community/<id>.yml`). The interactive picker's "Browse marketplace" entry lists the same workflows, and only appears when GitHub is reachable. Set `GITHUB_TOKEN` to raise GitHub's rate limit.

In a fresh repo, walks you through provider inference, credential collection, and writes `.sweny.yml` + `.env` + `.sweny/workflows/<id>.yml`. In a repo that already has `.sweny.yml`, adds the new workflow non-destructively — existing config is preserved and `.env` is append-only.

## sweny try

A recorded demo. Replays a saved `explain-repo` run through the real executor, so you see the real progress lines, the answer, the receipt ticket and the PR comment, with no login, no credentials, no network and no model calls.

```bash
sweny try
sweny try --fast        # skip the pacing
```

The label says what the recording is. Until a real run is committed it is illustrative sample data (a fictional repo, hand-written timings and token counts). A recording of a real run says "a replay of a real run on `<date>`" instead, with the recorded tool-call counts, tokens, cost and answer (redacted); its timings are scaled to about 8 seconds so the replay stays short. Nothing runs and no files are written. When you are ready for a real run, use [`sweny new`](#sweny-new).

On a live terminal the replay is paced by those scaled timings. Piped, under `CI`, or with `--fast` it prints at once. `NO_COLOR` turns color off.

### Capture a real run

`sweny try --capture <run>` turns a recorded run into the fixture `sweny try` replays. `<run>` is `latest`, a run id, or a path under `.sweny/runs/`. The run must have succeeded and been recorded by a sweny that keeps per-tool call counts. The answer is redacted again before it is written.

```bash
sweny try --capture latest --repo swenyai/sweny --out packages/core/src/cli/try-fixture.json
```

| Option | Description | Default |
|--------|-------------|---------|
| `--fast` | Replay instantly instead of pacing the progress | `false` |
| `--pace <ms>` | Fixed milliseconds per node | recorded timings, scaled |
| `--comment-file <path>` | Also write the PR-comment markdown to `<path>` | none |
| `--record <file.svg>` | Write the demo as an animated, self-contained SVG terminal recording to `<file.svg>` | none |
| `--capture <run>` | Convert a recorded run into a try fixture instead of replaying | none |
| `--repo <owner/name>` | With `--capture`: the repo the run was on | `GITHUB_REPOSITORY` |
| `--out <file>` | With `--capture`: write the fixture to `<file>` | stdout |

## sweny check

Verify that all configured provider credentials are valid and can connect.

```bash
sweny check
```

Reads providers from `.sweny.yml` and `.env`, then tests connectivity for each one. Prints a pass/fail status per provider with actionable error messages. Exits `0` if all providers pass, `1` if any fail.

The coding agent you picked (`--agent` or `coding-agent-provider`) gets its own lines, checked by its harness. None of them makes a model call or spends tokens, and no credential value is printed. They print even when the agent cannot run yet (a missing CLI or login), so a broken setup shows what is wrong. With `NO_COLOR` the output has no color; with `SWENY_ASCII=1` it uses ASCII glyphs and box lines.

| Agent | What `sweny check` verifies |
|-------|-----------------------------|
| `claude` | The version of the agent SDK sweny bundles for Claude Code; then a stored Claude Code login, or `ANTHROPIC_API_KEY` against `GET /v1/models` (or your gateway when `ANTHROPIC_BASE_URL` is set). An OAuth or bearer token with no gateway is reported by mode, without a network call. |
| `codex` | `codex --version` (the same binary and version floor a run uses); a credential (`CODEX_API_KEY`, `OPENAI_API_KEY`, `CODEX_ACCESS_TOKEN`, or `codex login`); `codex login status`; and, with an API key, `GET /models` on `OPENAI_BASE_URL` (default `https://api.openai.com/v1`). |
| `pi` | `pi --version`; and the one provider credential a run would hand pi, or the `SWENY_PI_MODELS_JSON` file. No upstream probe: pi talks to many providers. |
| `acp:<command>` | The command resolves on `PATH`. The agent is not started, so its version and login are reported when a run starts. |

```text
  Checking provider connectivity…

  ╭──────────────────────────────────────────────────╮
  │                                                  │
  │  Provider Connectivity Check                     │
  │                                                  │
  ├──────────────────────────────────────────────────┤
  │                                                  │
  │  ✓  Agent CLI (codex)                            │
  │       0.159.2                                    │
  │       (/path/to/bin/codex)                       │
  │  ✗  Agent auth (codex)                           │
  │       Missing: OPENAI_API_KEY or CODEX_API_KEY,  │
  │       or a Codex login (`codex login`), for      │
  │       --agent codex                              │
  │                                                  │
  ├──────────────────────────────────────────────────┤
  │                                                  │
  │  One or more checks failed. Fix the issues       │
  │  above before running a workflow.                │
  │                                                  │
  ╰──────────────────────────────────────────────────╯
```

Run this after initial setup or when rotating credentials.

## sweny setup

Create the standard SWEny label set in your issue tracker or source control provider. This is an interactive setup wizard with provider-specific subcommands.

### sweny setup linear

Create SWEny labels in a Linear workspace.

```bash
sweny setup linear --team-id <id>
```

| Option | Description | Default |
|--------|-------------|---------|
| `--team-id <id>` | Linear team ID (required) | `LINEAR_TEAM_ID` env var |

Requires `LINEAR_API_KEY` in your environment. Creates the `agent` parent label, work-type labels (`triage`, `feature`, `optimization`, `research`, `support`, `spec`, `task`), signal labels (`agent-needs-input`, `agent-error`, `human-only`, `needs-review`), and a `bug` label. Prints a config snippet ready to paste into `.sweny.yml`.

### sweny setup github

Create SWEny labels in a GitHub repository.

```bash
sweny setup github --repo <owner/repo>
```

| Option | Description | Default |
|--------|-------------|---------|
| `--repo <owner/repo>` | GitHub repository (required) | `GITHUB_REPOSITORY` env var |

Requires `GITHUB_TOKEN` in your environment. Creates the same label set as the Linear setup, referenced by name (no UUIDs needed for GitHub).

## sweny triage

Run the SWEny triage workflow: fetch errors from your observability platform, investigate root causes, create issues, and optionally open fix PRs.

```bash
sweny triage [options]
```

### Provider options

| Option | Description | Default |
|--------|-------------|---------|
| `--agent <provider>` | Coding agent: `claude`, `codex`, `pi` (experimental) or `acp:<command>` for any ACP agent (experimental); other values are rejected (alias: `--coding-agent-provider`) | `claude` |
| `--observability-provider <provider>` | Observability platform | `datadog` |
| `--issue-tracker-provider <provider>` | Issue tracker: `github-issues`, `linear`, `jira`, `file` | `github-issues` |
| `--source-control-provider <provider>` | Source control: `github`, `gitlab`, `file` | `github` |
| `--notification-provider <provider>` | Notification: `console`, `slack`, `teams`, `discord`, `email`, `webhook`, `file` | `console` |

### Investigation options

| Option | Description | Default |
|--------|-------------|---------|
| `--time-range <range>` | Time range to analyze (e.g. `1h`, `4h`, `24h`, `7d`) | `24h` |
| `--severity-focus <focus>` | Severity level focus | `errors` |
| `--service-filter <filter>` | Service filter glob pattern | `*` |
| `--investigation-depth <depth>` | Investigation depth: `quick`, `standard`, `thorough` | `standard` |
| `--max-investigate-turns <n>` | Max coding agent turns for investigation (1-500) | `50` |
| `--max-implement-turns <n>` | Max coding agent turns for implementation (1-500) | `30` |

### PR and branch options

| Option | Description | Default |
|--------|-------------|---------|
| `--base-branch <branch>` | Base branch for PRs | `main` |
| `--pr-labels <labels>` | Comma-separated PR labels | `agent,triage,needs-review` |
| `--issue-labels <labels>` | Comma-separated labels for agent-created issues | -- |
| `--repository <owner/repo>` | Repository (auto-detected from git remote) | -- |
| `--review-mode <mode>` | PR merge behavior: `auto` (merge when CI passes) or `review` (human approval) | `review` |

### Behavior options

| Option | Description | Default |
|--------|-------------|---------|
| `--dry-run` | Analyze only. Every node runs with read-only tools: write tools, external MCP servers, and shell/file-edit tools are withheld by the executor (on Codex, a shell confined to its OS read-only sandbox: no writes, no network), so no issues are created, no PRs opened, no notifications sent. Stops at the first natural-language conditional edge. See [Dry run](/workflows/#dry-run). | `false` |
| `--stage` | Run normally, but preview every issue, comment and PR instead of filing it; sweny blocks the push (env and git hooks; a guarantee only on a sandboxed run): see [No push under --stage](#no-push-under---stage-and---dry-run). See [Permissions and safe outputs](/workflows/yaml-reference/#permissions-and-safe-outputs). | `false` |
| `--no-novelty-mode` | Allow +1 on existing issues instead of skipping duplicates | -- |
| `--issue-override <issue>` | Work on a specific existing issue instead of scanning for new ones | -- |
| `--additional-instructions <text>` | Extra instructions passed to the coding agent | -- |

### Output options

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output results as JSON to stdout; suppress progress rendering | `false` |
| `--stream` | Stream NDJSON `ExecutionEvent` objects to stdout (for Studio / automation) | `false` |
| `--bell` | Ring terminal bell on completion | `false` |

### Provider-specific options

| Option | Description |
|--------|-------------|
| `--log-file <path>` | Path to JSON log file (for `--observability-provider file`) |
| `--dd-site <site>` | Datadog site (default: `datadoghq.com`) |
| `--sentry-org <org>` | Sentry organization slug |
| `--sentry-project <project>` | Sentry project slug |
| `--sentry-base-url <url>` | Sentry base URL (default: `https://sentry.io`) |
| `--cloudwatch-region <region>` | AWS CloudWatch region (default: `us-east-1`) |
| `--cloudwatch-log-group-prefix <prefix>` | CloudWatch log group prefix |
| `--splunk-index <index>` | Splunk index (default: `main`) |
| `--elastic-index <index>` | Elasticsearch index (default: `logs-*`) |
| `--newrelic-region <region>` | New Relic region (default: `us`) |
| `--prometheus-url <url>` | Prometheus base URL |
| `--prometheus-token <token>` | Prometheus bearer token |
| `--heroku-app-name <name>` | Heroku application name |
| `--opsgenie-region <region>` | OpsGenie region (default: `us`) |
| `--honeycomb-dataset <name>` | Honeycomb dataset name |
| `--axiom-dataset <name>` | Axiom dataset name |
| `--axiom-org-id <id>` | Axiom org ID |
| `--betterstack-source-id <id>` | Better Stack log source ID |
| `--betterstack-table-name <name>` | Better Stack ClickHouse table name |
| `--workspace-tools <tools>` | Comma-separated workspace tool integrations: `slack`, `notion`, `pagerduty`, `monday` |

## sweny implement

Implement a fix for an existing issue and open a PR. Fetches the issue from your tracker, investigates the codebase, implements a fix, and creates a pull request. No observability provider needed.

```bash
sweny implement <issueId> [options]
```

The `<issueId>` argument is the issue identifier from your tracker (e.g. `ENG-123` for Linear, `#42` for GitHub Issues).

| Option | Description | Default |
|--------|-------------|---------|
| `--agent <provider>` | Coding agent: `claude`, `codex`, `pi` (experimental) or `acp:<command>` for any ACP agent (experimental); other values are rejected (alias: `--coding-agent-provider`) | `claude` |
| `--issue-tracker-provider <provider>` | Issue tracker: `linear`, `jira`, `github-issues`, `file` | `linear` |
| `--source-control-provider <provider>` | Source control: `github`, `gitlab`, `file` | `github` |
| `--dry-run` | Analyze and plan only. Runs with read-only tools (no code edits, no PR, and no shell (on Codex, a shell confined to its OS read-only sandbox: no writes, no network)). See [Dry run](/workflows/#dry-run). | `false` |
| `--stage` | Run normally, but preview the PR and the issue comment instead of writing them. The branch is never pushed: see [No push under --stage](#no-push-under---stage-and---dry-run). | `false` |
| `--max-implement-turns <n>` | Max coding agent turns (1-500) | `40` |
| `--base-branch <branch>` | Base branch for PRs | `main` |
| `--repository <owner/repo>` | Repository (auto-detected from git remote) | -- |
| `--review-mode <mode>` | PR merge: `auto` or `review` | `review` |
| `--additional-instructions <text>` | Extra instructions for the coding agent | -- |
| `--stream` | Stream NDJSON events to stdout (for Studio / automation) | `false` |
| `--workspace-tools <tools>` | Comma-separated workspace tool integrations | -- |

### No push under --stage and --dry-run

With `--stage` or `--dry-run` (or `safe_outputs.staged: true` in a workflow), sweny sets up every node's agent environment so a push fails, on every agent (`claude`, `codex`, `pi`, ACP). The block is environment variables and a git hook: it stops an agent that pushes the normal way, but a deliberate agent can undo it unless the run is sandboxed. In CI with the sandbox on and no push credential in the agent's reach, it cannot push.

- **`git push`** fails. A bare `git push`, a push to any remote or URL (https, ssh, `git@`, `file://`, a local path), `--force` and `--no-verify` are all refused, through git config sweny sets for the agent and a sweny `pre-push` hook. Git's ssh transport refuses to push; ssh fetches still work.
- **No credential reaches git.** Credential helpers (keychain, `gh auth git-credential`, stored credentials) are reset and git's password prompt is off.
- **`gh` and raw API calls have no write token.** `GITHUB_TOKEN`, `GH_TOKEN`, GitLab and Bitbucket tokens, every skill credential (even one a node grants with `agent_env`) and the ssh agent socket are withheld from the agent, and `gh` gets an empty config, so `gh pr create` and a `curl` to the API with a token both fail. Skill tools (the `github` and `linear` skills) run inside sweny, not in the agent, so reads through them keep working.
- **No skill write tool runs.** Write tools (`github_create_pr`, `github_add_comment`, `linear_create_issue` and the rest) are withheld from every node, and sweny refuses any write tool call before its handler runs. So sweny's own branch push and API writes do not happen either; safe outputs are previewed instead. No skill or external MCP server is loaded in any node (an MCP server's tools cannot be classified, so any of them may write); skill tools still reach the agent through sweny's own channel, reads only.

Commits, diffs and fetches still work, so a staged run shows the change it would have pushed. The repository's own git hooks do not run in a staged node.

What this does not stop: an agent that deliberately unsets these variables (or passes `-c core.hooksPath=/dev/null`) and finds a credential on disk, such as an ssh key without a passphrase, a keychain entry, or a token a checkout persisted in `.git/config`, can still push on an unsandboxed run. Local runs are unsandboxed by default. The process sandbox wrapper, where it runs, hides credential files such as `~/.ssh` and `~/.git-credentials` and limits the network. Under a strict harness policy (`--harness-policy strict`, the default under GitHub Actions) a staged write node whose agent would run unsandboxed is refused instead of run; under `warn` it runs and the gap is listed in `degraded`.

## sweny workflow

Manage and run workflow files. All workflow subcommands operate on YAML or JSON workflow definitions.

### sweny workflow validate

Validate a workflow file without running it.

```bash
sweny workflow validate <file> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output result as JSON | `false` |

Exits `0` if valid, `1` with error details if not. Useful in CI to catch schema errors before deployment.

```bash
sweny workflow validate my-workflow.yml
# ✓ my-workflow.yml is valid

sweny workflow validate broken.yml
# ✕ broken.yml has 2 validation errors:
#     Missing required field: entry
#     Node "fetch" references unknown skill "nonexistent"
```

### sweny workflow upgrade

Rewrite a workflow file at the current spec version.

```bash
sweny workflow upgrade <file> [--dry-run]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--dry-run` | Report what would change without writing the file | `false` |

Workflows carry an optional `spec_version` (absent means `"1"`). Older files still load: the CLI migrates them in memory and prints one warning pointing here. `upgrade` applies the same migrations and writes the file back. YAML comments, blank lines and key order are kept for everything a migration does not touch; comments on values a migration replaces or removes are not. A file newer than your CLI is refused with a prompt to run `sweny upgrade`.

### sweny workflow run

Execute a workflow file. With no file argument, batch-runs every workflow in `.sweny/e2e/` (this is where end-to-end tests run, having replaced the old `sweny e2e run`).

```bash
sweny workflow run <file> [options]   # run one workflow
sweny workflow run [options]          # batch-run all .sweny/e2e/*.yml
```

| Option | Description | Default |
|--------|-------------|---------|
| `--dry-run` | Run with read-only tools only: write tools, external MCP servers, and shell/file-edit tools are withheld (on Codex, a shell confined to its OS read-only sandbox: no writes, no network), so nothing is created, posted, or sent. Stops at the first natural-language conditional edge. See [Dry run](/workflows/#dry-run). | `false` |
| `--list-nodes` | Validate the workflow and print its node list without running | `false` |
| `--json` | Output result as JSON to stdout; suppress progress rendering. Redacted like the final answer (see below) | `false` |
| `--stream` | Stream NDJSON events to stdout (for Studio / automation). Redacted like `--json` | `false` |
| `--mermaid` | Print a Mermaid diagram with per-node execution state after the run finishes | `false` |
| `--comment-file <path>` | Write an empty PR-comment file at `<path>` (kept for the Action). The receipt and DAG go to the job summary; findings a workflow posts on its PR use [one updating comment](/action/inputs/#pr-comment) | -- |
| `--timeout <ms>` | Whole-run wall-clock budget for `workflow run` (one file, or per workflow in batch runs). `0` disables the budget. Non-numeric values are rejected | `3600000` (60 min) |
| `--max-steps <n>` | Hard cap on total node executions for a single workflow file, including eval-failure retries | `200` |
| `--max-tokens <n>` | Run-wide token budget (input plus output) for a single workflow file. The lowest of this and the workflow's `budget.tokens` wins. A crossing stops the agent, fails the node and halts the run. See [Spend budgets](/workflows/yaml-reference/#spend-budgets) | none |
| `--max-cost <usd>` | Run-wide cost budget in US dollars, from harness-reported cost (never estimated). The lowest of this and the workflow's `budget.cost_usd` wins | none |
| `-y, --yes` | Skip the batch confirmation prompt (use in CI) | `false` |
| `--agent <id>` | Coding agent that runs the nodes: `claude`, `codex`, `pi` (experimental) or `acp:<command>` for any ACP agent (experimental) | `claude` |
| `--harness-policy <mode>` | `strict` refuses a node whose policy the agent cannot enforce; `warn` runs it and reports it as degraded. Env: `SWENY_HARNESS_POLICY` | `strict` under GitHub Actions, else `warn` |
| `--no-decider` | Skip the decision model for this run: the agent decides the routes of `route_by: decider` nodes. See [Decision models](/advanced/decision-models/) | decider on when configured |
| `--no-journal` | Do not write the run journal (kept in the sweny state dir, see [Resume a run](/cli/resume/#the-journal)). The run cannot be resumed. Or set `journal: off` in `.sweny.yml` | journal on |
| `--show-output` | Print the final answer in CI too. In CI (`GITHUB_ACTIONS` or `CI` set) the answer is saved to `.sweny/runs/<run-id>/output.md` and only that path is printed, unless this flag is set. Outside CI the answer is always printed. Either way it is redacted first | off in CI |

**`--json` and `--stream` are redacted.** Every value they print (node data, summaries, errors, tool call inputs and outputs) passes through the same redactor as the final answer and `output.md`: values of secret-named env vars and skill credentials, string fields with secret-looking names (`token`, `password`, `apiKey`, ...), and known token shapes (`ghp_...`, `sk-...`, `xox...`, AWS keys, private key blocks) become `[redacted]`. Keys and structure are unchanged, and non-secret values pass through as-is.

With a file, loads the definition, validates its schema, then executes it with the same DAG renderer and skill infrastructure as the built-in `triage` and `implement` commands. With no file, it lists every `.sweny/e2e/*.yml` workflow, asks you to confirm (skip with `--yes`), runs them sequentially with template variables (`{base_url}`, `{run_id}`, ...) resolved, and exits `0` if all pass, `1` if any fail. Provider settings from `.sweny.yml` and `.env` apply.

### sweny workflow resume

Resume a killed or failed `workflow run` from its journal. Finished nodes are replayed without calling the agent, the first unfinished node runs again, and writes already applied are not sent twice. See [Resume a run](/cli/resume/).

```bash
sweny workflow resume <run-id> [options]
sweny workflow resume <run-id> --plan    # show what would replay and re-run, run nothing
```

| Option | Description | Default |
|--------|-------------|---------|
| `--plan` | Print the resume plan and exit | `false` |
| `--force` | Resume although the workflow, its instruction files, the input, or the configured skills/agent changed (warns) | `false` |
| `--allow-repeat-writes` | Re-run nodes that may repeat a write outside safe outputs, and re-send writes whose outcome cannot be confirmed on the provider | `false` |
| `--workflow <file>` | Workflow file to load when it moved (its content must still match) | the path the run used |
| `--input <json>` | The run's original input, required when the journal redacted secrets from it | the journaled input |

`--timeout`, `--max-steps`, `--json`, `--stream`, `--verbose`, `--mermaid`, `--comment-file`, `--agent`, `--harness-policy`, `--no-decider`, `--show-output` and `--no-history` work as on `workflow run`. A run id prefix is enough when it is unique.

### sweny workflow diagram

Render a workflow as a [Mermaid](https://mermaid.js.org/) diagram. Handy for PR descriptions, runbooks, and anywhere GitHub/GitLab renders Mermaid natively.

```bash
sweny workflow diagram <file> [options]
```

The `<file>` argument accepts a path to a workflow YAML or JSON file, or the name of a built-in workflow (`triage`, `implement`, `seed-content`).

| Option | Description | Default |
|--------|-------------|---------|
| `--direction <dir>` | Graph direction: `TB` (top-bottom) or `LR` (left-right) | `TB` |
| `--title <title>` | Inject a `---\ntitle: …\n---` header (off by default — raw Mermaid has no title) | — |
| `--block` / `--no-block` | Wrap / don't wrap in a ` ```mermaid ` fenced code block | raw on stdout, `.mmd`, `.mermaid`; fenced on `.md`/`.markdown` |
| `-o, --output <path>` | Write the diagram to a file instead of stdout | — |

Output defaults to **raw Mermaid syntax** (no fence, no title frontmatter) — the format [`mmdc`](https://github.com/mermaid-js/mermaid-cli), the [Mermaid Live Editor](https://mermaid.live), and GitHub/GitLab inline renderers accept directly. When `-o` points at `.md` or `.markdown`, the output is auto-wrapped in a ` ```mermaid ` fenced block for paste-in-a-README use. `--block` / `--no-block` always wins if set explicitly.

```bash
# Raw Mermaid to stdout — pipe into mmdc, Live Editor, anything
sweny workflow diagram my-workflow.yml

# Canonical .mmd / .mermaid for tooling
sweny workflow diagram my-workflow.yml -o diagram.mmd
sweny workflow diagram my-workflow.yml -o diagram.mermaid

# Paste-ready markdown file for a PR description or README (auto-fenced)
sweny workflow diagram triage -o triage.md --direction LR

# Force fenced output to stdout (e.g. piping to pbcopy for a PR comment)
sweny workflow diagram my-workflow.yml --block | pbcopy

# Force raw output to a .md file (override the auto-fence)
sweny workflow diagram my-workflow.yml -o diagram.md --no-block
```

### sweny workflow export

Print a built-in workflow as YAML. Use this to get a starting point for customization.

```bash
sweny workflow export <name>
```

The `<name>` argument must be `triage` or `implement`.

```bash
# Export the triage workflow and save it for editing
sweny workflow export triage > my-triage.yml
```

### sweny workflow create

**Deprecated.** Use [`sweny new`](#sweny-new) and pick "Describe your own"; this command prints a deprecation warning.

Generate a new workflow from a natural language description.

```bash
sweny workflow create <description> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output workflow JSON to stdout (skip interactive prompt) | `false` |

In interactive mode, the CLI displays a DAG preview of the generated workflow and prompts you to save, refine, or discard:

```
  Save to .sweny/workflows/check-slow-queries.yml? [Y/n/refine]
```

Choosing `refine` (or typing a refinement instruction directly) sends your feedback back to the LLM to iterate on the design.

### sweny workflow edit

Edit an existing workflow file with natural language instructions.

```bash
sweny workflow edit <file> [instruction] [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output updated workflow JSON to stdout (skip interactive prompt) | `false` |

If `[instruction]` is omitted, the CLI prompts you interactively. After editing, the updated DAG is displayed with the same save/refine/discard flow as `workflow create`.

```bash
# Inline instruction
sweny workflow edit my-workflow.yml "add a Slack notification after creating tickets"

# Interactive
sweny workflow edit my-workflow.yml
#  What would you like to change? _
```

### sweny workflow list

List the skills currently configured (required env vars present) and available to workflow nodes.

```bash
sweny workflow list [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output as JSON array | `false` |

Prints each configured skill's ID, category, and description. For the full picture (built-in plus custom, configured plus unconfigured), use [`sweny skill list`](#sweny-skill-list) instead.

## sweny runs

Every `sweny workflow run` leaves a record in `.sweny/runs/`. Two commands read it back; neither calls an agent or the network.

```bash
sweny runs                      # recent runs, newest first
sweny runs diff                 # what changed since the run before, for the newest workflow with two runs
sweny runs diff <a> <b>         # two specific runs (a run id prefix is enough when it is unique)
sweny runs diff --workflow triage
```

| Option | Applies to | Description | Default |
|--------|-----------|-------------|---------|
| `--workflow <id>` | `runs`, `runs diff` | Only runs of this workflow; for `diff`, the pair is its last two runs | all workflows |
| `--limit <n>` | `runs` | Max runs to show | `20` |
| `--json` | `runs`, `runs diff` | Machine-readable output, no color | `false` |

After your first successful run in a workspace, `sweny workflow run` prints a short "Next" note once: `sweny runs`, `sweny runs diff`, and a link to [scheduling](/action/scheduling/). It is never printed in CI, with `--json`, `--stream` or `--dry-run`, or after a failed run, and it respects `NO_COLOR`. The marker that records it was shown lives in the sweny state dir (`$SWENY_STATE_DIR`, else `$XDG_STATE_HOME/sweny`, else `~/.local/state/sweny`), not in your repo.

### sweny runs diff

The diff leads with the answers: what each node's declared outputs gained, lost or changed between the older run (`a`) and the newer one (`b`). How the runs ran (status, duration, tokens, cost, retries, routes) follows. The last line is always plain text with the counts.

```text
  a  20261106-100412-3fa9c1  triage  ✓ success  2m10s
  b  20261107-100455-b71d02  triage  ✓ success  2m31s

  answers
    investigate
      findings     1 added · 1 resolved · 1 changed · 1 unchanged
        + Race in token refresh
        - Stale cache key
        ~ Null deref in checkout
            severity  medium → high
      novel_count  2 → 3

  workflow   unchanged (3f2a9c1)
  status     ✓ success (same)
  duration   2m10s → 2m31s (+21s)

  nodes
    investigate  ✓  duration 1m40s → 2m02s (+22s)
    report       ✓  no change

  routes
    identical

  answers: 1 added, 1 resolved, 3 changed, 1 unchanged
```

Color follows the usual rules: off under `NO_COLOR`, when output is not a terminal, and under `TERM=dumb`. `SWENY_ASCII=1` swaps the glyphs (`→`, `·`, `✓`) for ASCII.

**What is compared.** `workflow run` saves each successful node's declared output fields to `.sweny/runs/<run-id>/answers.json`: only the paths the node's `output` schema declares, nested ones included (`findings[].title` keeps `title` and nothing else); with no schema, a string `summary`. The file is local only, redacted like `output.md` (keys as well as values), and ignored by git. Strings over 2000 characters are cut in the file, but a change past the cut is still reported as changed. A node that failed or was skipped saves nothing, so it is reported as `not compared` and never as "everything resolved". `--no-history` and `history: off` skip the file.

**What counts as the same finding.** A list field (all objects, or all plain values) is compared item by item:

1. An object is identified by the first of `id`, `key`, `fingerprint`, `title`, `name` that holds a non-empty string or a number, trimmed, lowercased and with whitespace collapsed. `Null deref in checkout` and ` null  deref in CHECKOUT ` are the same finding.
2. An object with none of those fields is identified by its whole content. Any edit to it reads as one resolved and one added.
3. A plain string, number or boolean is identified by its normalized value.
4. Two items in one list with the same identity pair up in order.

A matched pair is `unchanged` when its content is identical and `changed` otherwise, listing the fields that differ. An item only in `b` is `added`; only in `a` is `resolved`. Any other field (a count, a string, an object) is one value: `added`, `resolved`, `changed` or `unchanged`. Long or multi-line strings show as `+2 -1 lines`. If the model rewords a finding's title between runs it reads as resolved plus added; put a stable `id` or `fingerprint` in the node's output schema when you need exact matching.

When two runs are of different workflows, or a run has no saved answers, the answers are not compared and the last line says why. `sweny runs diff` exits `1` when there is nothing to diff (no runs, or fewer than two of the workflow).

### JSON shape

`sweny runs diff --json` prints one object. The shape is stable; fields are only ever added.

```json
{
  "schema_version": 1,
  "a": { "run_id": "...", "workflow_id": "...", "status": "success", "...": "the run record, as in `sweny runs --json`" },
  "b": { "...": "..." },
  "answers": {
    "available": true,
    "counts": { "added": 1, "resolved": 1, "changed": 3, "unchanged": 1 },
    "entries": [
      {
        "node": "investigate", "field": "findings", "kind": "collection",
        "added":    [{ "id": "race in token refresh", "label": "Race in token refresh", "value": { "title": "...", "severity": "high" } }],
        "resolved": [{ "id": "stale cache key", "label": "Stale cache key", "value": { "...": "..." } }],
        "changed":  [{ "id": "null deref in checkout", "label": "Null deref in checkout",
                       "fields": [{ "field": "severity", "before": "medium", "after": "high" }] }],
        "unchanged": 1
      },
      { "node": "investigate", "field": "novel_count", "kind": "value", "status": "changed", "before": 2, "after": 3 }
    ],
    "not_compared": [{ "node": "report", "only_in": "a" }]
  }
}
```

When the answers cannot be compared, `answers` is `{ "available": false, "reason": "different_workflows" }` or `{ "available": false, "reason": "missing_answers", "missing": ["a"] }`. A value entry's `status` is `added`, `resolved`, `changed` or `unchanged`; `before` and `after` are present when they apply.

### Since the last run

After a run that has an earlier run of the same workflow, `workflow run` prints one dim line under the receipt, adds it to the GitHub step summary, and links the command:

```text
since last run: 1 added, 1 resolved (sweny runs diff --workflow triage)
```

It carries counts only, never the text of an answer, and the workflow id in the command is the current run's own. If a node could not be compared (it failed, was skipped, or had no output in one of the runs) the line says `N not compared` instead of reading as no changes. History is never trusted for what gets printed: records whose id does not match their file name, or that repeat another run's id, are ignored. In GitHub Actions the history is empty on every run unless you keep `.sweny/runs` between runs: see [keep run history between runs](/action/scheduling/#keep-run-history-between-runs).

## End-to-end browser testing

E2E testing has no dedicated namespace — it uses the two commands above:

- **Scaffold** with [`sweny new e2e`](#sweny-new) — the wizard generates `.sweny/e2e/<flow-name>.yml` files and appends env vars to `.env`.
- **Run** with [`sweny workflow run`](#sweny-workflow-run) — no file argument batch-runs every workflow in `.sweny/e2e/`.

See the [E2E Testing guide](/cli/e2e/) for the full walkthrough.

## sweny skill

Author and inspect skills. Skills are the unit of capability a workflow node references via its `skills:` array. The CLI ships built-ins (`github`, `linear`, `slack`, ...) and discovers custom skills from `.{sweny,claude,agents,gemini}/skills/<id>/SKILL.md`.

### sweny skill new

Scaffold a `SKILL.md` template for a new custom skill.

```bash
sweny skill new <id> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-d, --description <text>` | One-line description (becomes the `description:` frontmatter field). | `Custom <id> skill` |
| `-c, --category <category>` | One of `general`, `git`, `tasks`, `notification`, `observability`, `data`. | `general` |
| `--harness <name>` | Where to place the skill: `claude`, `sweny`, `agents`, `gemini`. | `claude` |
| `--force` | Overwrite an existing `SKILL.md` instead of refusing. | off |

The scaffold writes frontmatter (with commented-out `config:` and `mcp:` blocks ready to uncomment) and a body skeleton documenting when to use the skill, what it provides, common failure modes, and an example invocation. See [Custom Skills](/skills/custom/) for the full format.

```bash
sweny skill new voyage-embeddings -d "Embed text via Voyage AI" -c data
# Created .claude/skills/voyage-embeddings/SKILL.md
```

Exit codes: `0` on success, `1` when the target file already exists and `--force` is not set, `2` for invalid id, category, or harness.

### sweny skill list

List built-in and custom skills together with their configuration status.

```bash
sweny skill list [--json]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output the full list as JSON (for scripting). | off |

Each row shows `✓` (required env vars present) or `·` (skill is discoverable but not configured), plus the skill's category and a `builtin` or `custom` tag. Custom skills that override a built-in id appear once, marked `custom`.

```bash
sweny skill list --json
# [
#   { "id": "github", "kind": "builtin", "category": "git", "configured": true, ... },
#   { "id": "voyage-embeddings", "kind": "custom", "category": "data", "configured": false, ... }
# ]
```

## sweny publish

Publish a workflow or skill. Interactive CLI that validates your content and opens a pull request against the swenyai/marketplace repository.

```bash
sweny publish
```

Walks you through:

1. **Select type** — workflow or skill
2. **Select path** — pick the file (workflow) or directory (skill) to publish
3. **Validate** — checks schema, frontmatter, and structure
4. **Metadata** — add tags, category, and description
5. **Submit**: forks swenyai/marketplace via `gh`, creates a branch, and opens a PR

Requires the [GitHub CLI](https://cli.github.com/) (`gh`) to be installed and authenticated. If `gh` is not available, the command saves validated files locally to `./sweny-publish/` for manual submission.

## sweny upgrade

Upgrade the globally-installed `@sweny-ai/core` CLI to the latest published version. Aliased as `sweny update`.

```bash
sweny upgrade
```

Detects how you installed sweny (npm, pnpm, yarn, bun, volta, Homebrew) and runs the right installer. Prints the exact command it's about to run so there's no surprise.

| Option | Description |
|--------|-------------|
| `--check` | Report the available version and the install command without running it |
| `--force` | Reinstall even if the current version is already latest |
| `--tag <tag>` | Install a specific npm dist-tag (default: `latest`; e.g. `--tag beta`) |

Examples:

```bash
# Dry-run — see what would be installed
sweny upgrade --check

# Install a pre-release
sweny upgrade --tag beta

# Force a reinstall of the current version
sweny upgrade --force
```

**Passive version check.** Every sweny command ends with a one-line footer when a newer release is available:

```
› sweny 0.1.66 is available (you have 0.1.65). Run `sweny upgrade`
```

The check asks the npm registry (`registry.npmjs.org`) for the latest `@sweny-ai/core` version and sends nothing else. After a successful check the answer is cached for 24 hours; a failed or timed-out check is not cached, so it is retried on the next command. It is skipped in CI, when stderr is not a terminal, for `sweny try`, and when `SWENY_NO_UPDATE_CHECK=1` or `SWENY_OFFLINE=1` is set.

**Homebrew installs** are detected but not driven automatically — the command prints `brew upgrade sweny` for you to run.

## Deprecated flags

These flags did nothing and were removed from the docs, then restored so existing scripts and CI jobs (the `swenyai/triage` action passes most of them) keep running. They are accepted, hidden from `--help`, and have no effect. Using one prints a single warning to stderr; they will be removed in a future minor version, so drop them from your invocations.

- `sweny triage`: `--cache-dir`, `--cache-ttl`, `--no-cache`, `--service-map-path`, `--gitlab-base-url`, `--linear-bug-label-id`, `--linear-triage-label-id`, `--linear-state-backlog`
- `sweny triage` and `sweny implement`: `--output-dir`, `--linear-team-id`, `--linear-state-in-progress`, `--linear-state-peer-review`

The matching environment variables and `.sweny.yml` keys are ignored too, and never raised an error.

## Global options

These options are available on all commands:

| Option | Description |
|--------|-------------|
| `--version` | Print the CLI version |
| `--help` | Show help for a command |

## Environment variables

| Variable | Effect |
|--------|-------------|
| `SWENY_NO_UPDATE_CHECK=1` | Suppress the "new version available" footer |
| `SWENY_OFFLINE=1` | Same as above; also recommended for airgapped environments |
| `CI=1` | Automatically suppresses the footer (set by most CI systems) |
