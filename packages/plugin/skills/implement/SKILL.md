---
name: implement
description: Pick up an issue and implement a fix with SWEny. Use when the user has an issue ID or URL they want resolved.
disable-model-invocation: true
allowed-tools: Bash
context: fork
agent: sweny-workflow
argument-hint: "<issue-id-or-url>"
---

# SWEny Implement

Run the SWEny implement workflow. This fetches an issue from the configured tracker (GitHub Issues, Linear, Jira), analyzes the codebase, implements a fix, and opens a pull request.

**Requires:** An issue ID or URL as the first argument.

## Usage

```bash
sweny implement $ARGUMENTS --stream
```

If the user did not provide an issue ID, ask them for one before running. Do not run without an issue ID — the CLI will fail.

For dry-run mode (analyze and plan without creating a PR):

```bash
sweny implement $ARGUMENTS --stream --dry-run
```

## What to expect

- The workflow takes 3-10 minutes depending on complexity
- SWEny creates a branch, makes changes, commits, and opens a PR
- On completion, report: branch name, PR URL, and a brief summary of changes
- If it reports "Too Complex", the issue needs human intervention

## Common flags

- `--dry-run` — analyze and plan without creating a branch or PR
- `--base-branch <branch>` — base branch for the PR (default: main)
- `--max-implement-turns <n>` — max coding agent turns (default: 40)
