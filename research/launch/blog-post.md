# DRAFT: blog post for nateross.dev (not published)

Status: draft for owner review. Refs swenyai/sweny#351.
Target slug: `/blog/claude-code-workflows-you-can-check-in`
Series hook: Part 3 of the Claude Code tutorials (understand new codebases).

Before publishing:
- [ ] Run steps 1 to 4 on a clean machine and paste the real receipt line and the real `sweny runs` table where marked `OWNER: paste`.
- [ ] Screenshot the PR comment from step 6 on a real PR and add it.
- [ ] Add a link to this post from the three `/blog/claude-code-tutorials/part-*` pages.

---

## Title

Claude Code workflows you can check in

## Intro

In [Part 3](https://nateross.dev/blog/claude-code-tutorials/part-3-understand-new-codebases) we asked Claude
Code to explain a codebase by hand: open a session, type the prompt, read the answer. It works, and you do it
again from scratch on every repo.

This post turns that prompt into a file. A two-step workflow you commit next to your code, run with one command,
and run again in CI on every pull request. It takes about five minutes.

The tool is [SWEny](https://github.com/swenyai/sweny?utm_source=nateross.dev&utm_medium=blog&utm_campaign=sweny-launch),
an open-source (MIT) workflow runner for coding agents. Each step of a workflow is a coding-agent run. SWEny
decides what that run can touch, checks what it hands back, and prints a receipt when it is done. It runs on
Claude Code today; a Codex adapter is in progress.

**What you'll learn**
- Scaffold and run a workflow with no tokens beyond your Claude login
- Read the YAML: nodes, edges, instructions
- Add an output contract so a step fails loudly instead of guessing
- Run it read-only, then in GitHub Actions with a PR comment

**Requirements**
- Node 20+
- Claude Code signed in (`claude`), or an `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`
- A git checkout you want explained

## Step 1: scaffold

```bash
cd ~/projects/some-repo
npm install -g @sweny-ai/core
sweny new --template explain-repo --yes
```

That writes three things and touches a fourth:
- `.sweny/workflows/explain-repo.yml`, the workflow
- `.sweny.yml`, project config
- `.env`, for credentials (this workflow needs none)
- `.gitignore`, with `.env` added

Check that it is valid and see its shape:

```bash
sweny workflow validate .sweny/workflows/explain-repo.yml
sweny workflow diagram .sweny/workflows/explain-repo.yml
```

## Step 2: read the YAML

```yaml
id: explain-repo
name: Explain This Repo
description: Read the local checkout and explain what it does, how it is laid out, and how to run it.
workflow_type: generic
entry: survey

nodes:
  survey:
    name: Survey the Repo
    instruction: |
      Look at the current directory. Read the README, the package or
      build manifests, and the top-level layout. Identify the main
      languages, the entry points, and the key directories.
      Only read files. Do not modify anything.

  explain:
    name: Explain It
    instruction: |
      From the survey, write a short plain-English explanation:
      what this project does, how it is organized, how to build and
      run it, and where a new contributor should start.
      Keep it under 300 words.

edges:
  - from: survey
    to: explain
```

Two nodes, one edge. Each node is its own agent run with its own instruction, and the second one gets the
first one's result as context. That is the Part 3 prompt split into "look" and "explain", which is already
more reliable than one long prompt: the survey can't skip ahead to writing prose.

## Step 3: run it

```bash
sweny workflow run .sweny/workflows/explain-repo.yml
```

You see each node start and finish, then one line at the end:

```
OWNER: paste the real receipt line from your run, e.g.
✓ 2/2 nodes · <tool calls> · <duration> · <tokens> · <cost>
```

That is the receipt: nodes that passed, tool calls the agent made, wall-clock time, tokens, and cost as the
agent SDK reported it. SWEny never estimates cost; if the SDK reports none, the segment is left off.

Every run is also recorded locally (metadata only, no prompts or outputs) under `.sweny/runs/`:

```bash
sweny runs          # recent runs: status, duration, tokens, cost
sweny runs diff     # the last two runs of the same workflow, side by side
```

```
OWNER: paste the real `sweny runs` table
```

## Step 4: add a contract

Prose is fine for a human. The next step in a pipeline wants fields. Give `explain` an output schema:

```yaml
  explain:
    name: Explain It
    instruction: |
      From the survey, explain this project for a new contributor.
    output:
      type: object
      properties:
        summary:
          type: string
        build_command:
          type: string
        start_here:
          type: array
          items:
            type: string
      required: [summary, start_here]
```

If the agent comes back without `summary` or `start_here`, the node fails (or retries, if you give it `retry`).
It does not quietly pass a half-built result to the next step. The same goes for a step that returns nothing
at all: that is a failure, never a success.

## Step 5: what SWEny holds the agent to

The agent does the work. These are the rules around it, and they are the same on every run:

- **Scoped secrets.** In CI the agent process gets an allowlist of env vars plus only what the node's skills
  declare. Your other CI secrets never reach it. Locally this is opt-in (`env-scope: on` in `.sweny.yml`).
- **Sandboxed commands.** In CI, agent shell commands run in the SDK sandbox when the host supports it.
- **Untrusted input stays data.** Inputs and upstream results are fenced as untrusted before they reach the
  model, and a payload can't close the fence.
- **Read-only dry run.** `--dry-run` withholds shell, write, edit and web-fetch tools and external MCP servers,
  so nothing gets created, posted or sent:

```bash
sweny workflow run .sweny/workflows/explain-repo.yml --dry-run
```

- **Timeouts.** A whole run has a wall-clock budget (60 minutes by default, `--timeout` to change it) and a
  step cap (`--max-steps`).

These rules live behind one adapter interface with a 14-case contract suite (env, MCP isolation, read-only,
output checks, timeouts, abort, fencing, cleanup). Claude Code passes it on every CI run. Any other agent has
to pass the same suite before SWEny lists it as supported.

## Step 6: run it on every PR

```yaml
# .github/workflows/explain-repo.yml
name: explain-repo
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  explain:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: swenyai/sweny@v5
        with:
          workflow: .sweny/workflows/explain-repo.yml
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

On a pull request, the Action posts one comment and updates it on every push: the receipt, the workflow DAG
colored by node status, and a per-node table. Metadata only, no prompts or model output. Set
`pr-comment: false` to turn it off. Fork PRs get a read-only token, so the comment is skipped with a warning.

```
OWNER: screenshot of the PR comment on a real PR
```

## Where to go next

- Swap `explain-repo` for a real job: `sweny new` lists the built-in templates (PR review, issue triage and more).
- Write a workflow from a sentence: pick "Describe your own" in `sweny new`.
- Docs: [docs.sweny.ai](https://docs.sweny.ai/getting-started/quick-start/?utm_source=nateross.dev&utm_medium=blog&utm_campaign=sweny-launch)
- Source: [github.com/swenyai/sweny](https://github.com/swenyai/sweny?utm_source=nateross.dev&utm_medium=blog&utm_campaign=sweny-launch)

The CLI and the Action are free. There is a hosted dashboard in the works that is not open yet; if you want to
hear when it is, the waitlist is at
[cloud.sweny.ai](https://cloud.sweny.ai/?utm_source=nateross.dev&utm_medium=blog&utm_campaign=sweny-launch#waitlist).
