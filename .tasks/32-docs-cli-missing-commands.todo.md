# Task 32 — Docs: add missing CLI commands to docs/cli/index.md

## Goal

`docs/cli/index.md` only covers `sweny triage`. The CLI has several other
commands that power users will reach for immediately and find undocumented:
- `sweny check` — verify provider credentials before running
- `sweny implement` — implement a fix for an existing issue
- `sweny workflow run` — run any YAML/JSON workflow file with live output
- `sweny workflow validate` — validate a workflow file without running
- `sweny workflow list` — list all registered step types
- `sweny workflow export` — export a built-in workflow as YAML

## Context

### `sweny check`
Verifies that all configured providers can connect successfully. Run this
after setting up credentials to confirm everything works before a real run.
```bash
sweny check
```
Checks connectivity for: observability provider, issue tracker, source control,
coding agent, notification. Prints ✓ / ✗ per provider with actionable error
messages for failures.

### `sweny implement`
Takes an existing issue identifier and produces a fix PR without doing any
log investigation first.
```bash
sweny implement --issue-identifier ENG-123
sweny implement --linear-issue ENG-123   # same flag, alternative name
```
Requires: issue tracker provider, source control provider, coding agent.
Does NOT require an observability provider.

### `sweny workflow run`
Runs a YAML or JSON workflow definition file directly. Streams live step-by-step
output to stderr as each step enters and exits:
```bash
sweny workflow run .sweny/workflows/my-workflow.yml
```
Output format (when connected to a TTY):
```
  ▲ my-workflow

  ○ verify-setup…
  ✓ verify-setup  234ms
  ○ do-work…
  ✓ do-work  4.2s
  ○ notify…
  ✓ notify  180ms
```
Flags:
- `--dry-run` — validate without running
- `--steps <path>` — path to a JS/TS module that registers custom step types
- `--json` — output result as JSON on stdout (suppresses progress output)

### `sweny workflow validate`
Validates a workflow definition file without running it:
```bash
sweny workflow validate .sweny/workflows/my-workflow.yml
```
Exits 0 if valid, 1 with error messages if not. Good for CI.

### `sweny workflow list`
Lists all registered step types (built-in + any custom types you've loaded):
```bash
sweny workflow list
sweny workflow list --steps ./my-steps.js  # include custom steps
```

### `sweny workflow export`
Exports a built-in workflow definition as YAML to use as a starting point:
```bash
sweny workflow export triage > .sweny/workflows/triage.yml
sweny workflow export implement > .sweny/workflows/implement.yml
```

## What to add

Add a new section to `packages/web/src/content/docs/cli/index.md` **after the
existing "Step caching" section and before "JSON output"**. Call it
`## Other commands`.

Structure:
```markdown
## Other commands

### sweny check

Verify provider credentials before running a workflow...
[show command + example output]

### sweny implement

Implement a fix for an existing issue without running log investigation...
[show command]

### sweny workflow

Run, validate, export, and inspect custom workflow files.

**Run a workflow file with live output:**
[show command + output example]

**Validate without running:**
[show command]

**List available step types:**
[show command]

**Export a built-in workflow:**
[show command]
```

Also add entries to **"What's next?"** at the bottom:
- Link to the studio recipe-authoring page (which has the `createWorkflow` / `runWorkflow` API docs)

## Done when

- [ ] `sweny check` documented with example
- [ ] `sweny implement --issue-identifier` documented
- [ ] `sweny workflow run` documented with live output example
- [ ] `sweny workflow validate`, `list`, `export` documented
- [ ] `--json` flag documented for `workflow run`
- [ ] Section is in logical reading order (check first, then implement, then workflow subcommands)
- [ ] No changeset needed (packages/web is private)
