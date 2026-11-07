---
title: Quick Start
description: "From npx to a first useful run in six steps: credentials, a named workflow, a preflight check, a run, the receipt, and what next."
---

Six steps from nothing to a first useful result. The receipt at the end tells you what the run cost.

## 1. Know what you need

Node 20+, and a login or API key for the agent that runs your nodes. Claude Code is the default; pick another with `--agent` (Action input `agent`).

| Agent | Credentials it needs |
|-------|----------------------|
| Claude Code (default) | `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`), or `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`, or a Claude Code login (`claude`, then `/login`), or Bedrock / Vertex routing (`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`). |
| Codex (`--agent codex`) | `CODEX_API_KEY`, `OPENAI_API_KEY` or `CODEX_ACCESS_TOKEN`, or a `codex login`. |
| pi (`--agent pi`) | The API key of the model provider pi calls (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, ...). |
| ACP agent (`--agent "acp:<command>"`) | Whatever that agent needs. Pass its API key env var through `SWENY_ENV_PASSTHROUGH`. |

Skill credentials (`GITHUB_TOKEN` and so on) are separate and only needed by workflows that use those skills. The `explain-repo` starter needs none. See [Agents and policies](/getting-started/agents-and-policies/) for what each agent can enforce.

## 2. Pick a named workflow

```bash
npx @sweny-ai/core new
```

The picker lists named workflows (`explain-repo`, `pr-review`, `security-scan`, `release-notes`, and more) and the recurring packs (`weekly-digest`, `dependency-drift`, `pr-risk-review`). Start with `explain-repo`: it reads your checkout and needs no skill credentials. To skip the prompts:

```bash
npx @sweny-ai/core new --template explain-repo --yes
```

It writes `.sweny.yml`, `.env` (added to `.gitignore`) and `.sweny/workflows/explain-repo.yml`. Install once with `npm install -g @sweny-ai/core` if you want the shorter `sweny` binary; the rest of this page uses it.

## 3. Check before you run

```bash
sweny check
```

Verifies your agent login and only the credentials your workflows need, and stops with the fix when one is missing. Nothing has run yet.

## 4. Run it

```bash
sweny workflow run .sweny/workflows/explain-repo.yml
```

## 5. Read the receipt

The run ends with the answer, then a receipt. Your numbers will differ:

```text
╭┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╮
┆ ✓ passed                          run 3f9a2c ┆
┆ explain-repo                                 ┆
┆                                              ┆
┆ nodes       2/2                              ┆
┆ tool calls  12                               ┆
┆ duration    28s                              ┆
┆ tokens      30k                              ┆
┆ cost        $0.13                            ┆
┆ policy      env scoped, sandbox on           ┆
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤
┆          [ ENV SCOPED · SANDBOXED ]          ┆
╰┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╯
```

The answer is also saved to `.sweny/runs/<id>/output.md`. In CI the receipt is one plain line.

## 6. What next

After your first successful run in a workspace, the CLI prints this once (never in CI):

```text
  ▲ Next
    sweny runs                          see this run and the ones before it
    sweny runs diff                     run it again, then see what changed in the answers
    sweny new --template weekly-digest  put it on a schedule in CI
  Packs and the Action: https://docs.sweny.ai/workflows/packs/
```

- `sweny runs` lists your local history.
- Run the workflow again, then `sweny runs diff` compares the two runs: what changed in the answers first, then duration, tokens and cost. See [`sweny runs`](/cli/commands/#sweny-runs).
- A [recurring pack](/workflows/packs/) puts a workflow on a schedule with the [GitHub Action](/action/).

:::note[Want to watch first?]
`sweny try` replays a recorded demo: no login, no credentials, no network, no model calls. The data is illustrative sample data, not a real run, and it writes no files. Run `sweny try` to see the receipt before you spend anything.
:::

## Other ways to run it

### Claude Code Plugin — use SWEny inside Claude Code

If you use [Claude Code](https://code.claude.com), install the plugin and get 9 slash commands, MCP tools, and a startup hook:

```
/plugin marketplace add swenyai/sweny
/plugin install sweny@sweny-official
```

Then use `/sweny:triage` to investigate production alerts, `/sweny:implement ENG-123` to fix an issue, `/sweny:e2e-run` to run browser tests, or `/sweny:new` to create a workflow, all without leaving your conversation.

**[Full plugin guide](/advanced/mcp-plugin/)** — all skills, MCP tools, hooks, and agent details.

### CLI — build and run workflows from your terminal

Beyond the starters: describe a task, get a workflow, run it.

```bash
# Create a workflow from a description: pick "Describe your own", then describe the task:
# "scan the codebase for security anti-patterns and create tickets for critical findings"
sweny new

# Refine it
sweny workflow edit .sweny/workflows/security_scan.yml \
  "add a quality gate that rejects vague findings"

# Run it
sweny workflow run .sweny/workflows/security_scan.yml
```

You can also run the built-in workflows directly:

```bash
sweny triage --dry-run          # investigate production errors
sweny implement ENG-123         # fix a tracked issue and open a PR
```

Or generate AI-driven browser tests for any web app:

```bash
sweny new e2e                   # wizard generates test workflows
sweny workflow run              # AI agent drives a real browser
```

**[Full CLI guide](/cli/)** — commands, configuration, and real-world examples. **[E2E testing guide](/cli/e2e/)** — browser test generation and execution.

### GitHub Action — deploy workflows to CI

Put workflows on a schedule. Every run writes its receipt to the job summary.

```yaml
# .github/workflows/sweny-weekly-digest.yml (written by `sweny new --template weekly-digest`)
- uses: swenyai/sweny@v5
  with:
    workflow: .sweny/workflows/weekly-digest.yml
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

One secret. Run the workflow locally once first, commit the two files `sweny new` wrote, then trigger it from the Actions tab and check the summary. See [Packs](/workflows/packs/) for the trigger, permissions and what each pack writes.

**[Full Action guide](/action/)** — setup, inputs, scheduling, and service maps.

### Studio — visualize and monitor workflows

A visual DAG editor built on React Flow. Design workflows by dragging nodes. Live mode connects to a WebSocket or SSE event URL you provide and overlays node state as events arrive.

```bash
# From a repo checkout
npm run dev -w @sweny-ai/studio
```

**[Full Studio guide](/studio/)** — editor, embedding, and live mode.

## What's next?

- **[Core Concepts](/getting-started/concepts/)** — understand workflows, nodes, edges, and skills
- **[CLI Examples](/cli/examples/)** — real-world workflows from one-liners to complex pipelines
- **[End-to-End Walkthrough](/getting-started/walkthrough/)** — follow a real triage run from error spike to fix PR
