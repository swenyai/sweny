# Task 26 — CLI: real-time step output for `sweny workflow run`

## Goal

`sweny workflow run <file>` currently shows no output while the workflow is
running — it just hangs until it finishes. Add live step-by-step output so
users can see what's happening, matching the spinner experience in `sweny triage`.

This is a **retention + product value** feature: users debugging custom
workflows need to see which step is executing so they can pinpoint failures.

## Context

- **`packages/cli/src/main.ts`** — The `workflow run` command handler (search for `workflowRunAction` or the run subcommand). Read this section carefully.
- **`packages/engine/src/types.ts`** — `RunObserver` interface with `onEvent(event: ExecutionEvent)`.
- The `ExecutionEvent` union includes `workflow:start`, `step:enter`, `step:exit`, `workflow:end` — all have `timestamp`.
- The `sweny triage` command already has a rich spinner with `beforeStep`/`afterStep` hooks — use that as a reference for the output style.

## What to implement

### Add a RunObserver to the workflow run command

In the `workflowRunAction` function in main.ts, create a `RunObserver` that
prints to stderr as events arrive:

```typescript
const observer: RunObserver = {
  onEvent(event) {
    switch (event.type) {
      case "workflow:start":
        process.stderr.write(`\n  ▲ ${chalk.bold(event.workflowName)}\n\n`);
        break;
      case "step:enter":
        process.stderr.write(`  ${c.subtle("○")} ${chalk.dim(event.stepId)}…\n`);
        break;
      case "step:exit": {
        const icon = event.result.status === "success" ? c.ok("✓") : event.result.status === "skipped" ? c.subtle("−") : c.fail("✗");
        const cached = event.cached ? chalk.dim(" [cached]") : "";
        const elapsed = `${Math.round((Date.now() - event.timestamp) / 100) / 10}s`; // rough
        // Overwrite the "○ step…" line with the final status
        process.stderr.write(`\x1B[1A\x1B[2K  ${icon} ${event.stepId}${cached}  ${c.subtle(elapsed)}\n`);
        break;
      }
      case "workflow:end":
        process.stderr.write(`\n`);
        break;
    }
  }
};
```

Pass the observer to `runWorkflow`:
```typescript
await runWorkflow(workflow, config, registry, { observer });
```

Note: Use `step:enter` + ANSI cursor-up `\x1B[1A\x1B[2K` to overwrite the
pending line with the final result — this gives a clean "each step flips from
● to ✓/✗" animation.

The observer should only be active when NOT in `--json` mode (JSON output
should remain on stdout, status on stderr).

### Keep existing behavior

- JSON output (`--json`) → results on stdout, no observer output
- Human output → observer prints to stderr; final result summary on stdout
- `--steps` flag for custom step types continues to work unchanged

## Changeset

```md
---
"@sweny-ai/cli": minor
---
`sweny workflow run` now streams live step-by-step output to stderr as each
step enters and exits, matching the experience of `sweny triage`.
```

## Done when

- [ ] Observer created and wired to `runWorkflow` in the workflow run command
- [ ] Output written to stderr (not stdout) so it doesn't interfere with `--json`
- [ ] `npx tsc --noEmit` clean in `packages/cli`
- [ ] Changeset created
- [ ] Manual test: `sweny workflow run .sweny/workflows/triage.yml` shows live output
