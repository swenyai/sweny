# Task 59: Document dry-run hard gate behavior

## Goal
Add clear documentation about how dry-run works — it's executor-enforced, not LLM-enforced. This is a key safety/trust feature.

## Where to add
1. **`workflows/index.md`** — Add a "Dry Run" section explaining the hard gate mechanism
2. **`cli/commands.md`** — Enhance the `--dry-run` flag description
3. **`action/inputs.md`** — Enhance the `dry-run` input description
4. **`getting-started/quick-start.md`** — Make sure the dry-run step explains what actually happens

## What to document
The dry-run behavior works like this (verify against `packages/core/src/executor.ts`):
- When `dryRun: true`, the executor runs nodes normally (Claude does real work — reads logs, analyzes errors)
- At each node transition, the executor checks if outgoing edges have `when` conditions (conditional routing)
- If ANY conditional edge is found, execution **stops immediately** — the executor returns results so far
- This is a **hard gate enforced by the executor**, not a prompt instruction to Claude. Claude cannot bypass it.
- Unconditional edges (no `when` clause) are followed normally during dry run
- Effect in triage: runs `prepare` → `gather` → `investigate`, stops before `create_issue`/`skip` decision
- Effect in implement: runs `analyze`, stops before `implement`/`skip` decision
- Zero side effects: no issues created, no PRs opened, no notifications sent

## Tone
Frame this as a trust/safety feature. Users should feel confident that dry-run truly cannot create side effects. Mention it's not an LLM promise — it's code enforcement.

## Verification
- Read `packages/core/src/executor.ts` to confirm the exact mechanism
- Make sure the description matches what the code actually does
