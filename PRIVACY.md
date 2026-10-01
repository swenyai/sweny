# SWEny Privacy

SWEny is an open-source CLI and GitHub Action. It does not collect telemetry by default.

## What we do NOT do

- No anonymous usage telemetry
- No crash reporting phone-home
- No reading or exfiltrating your code
- No forwarding of `GITHUB_TOKEN` to any third party

## Local files

`sweny workflow run` writes these files. None of them is ever sent anywhere.

In `.sweny/runs/` in your working directory:

- **Run history record** (`<run-id>.json`): metadata only (statuses, durations, counts). The 200 most recent are kept. Turn it off with `--no-history` or `history: off` in `.sweny.yml`.
- **Final answer** (`<run-id>/output.md`, mode `0600`): the run's answer, the final node's declared output fields or summary, or the failed node's error. Secret-looking values are redacted first (see below). It is deleted with its run directory: when its history record is pruned, or when its journal is pruned (the 20 most recent journals are kept). `--no-history` skips it. In CI it is not printed to the log unless you pass `--show-output` (Action input `show-output: true`); only its path is.
- **Run journal** (`<run-id>/journal.ndjson`, mode `0600`), so `sweny workflow resume` can continue a killed run: node results, eval verdicts, safe-output requests and receipts, token and cost usage, routing decisions, and the run input. Secret-looking values are redacted; environment variables are never written. The 20 most recent journals are kept. Turn it off with `--no-journal` or `journal: off` in `.sweny.yml`.
- **Journal lock** (`<run-id>/journal.lock`): the process id holding the journal, removed when the run ends.
- **`<run-id>/.gitignore`**: `*`, so an agent's `git add -A` never commits a run directory.

Outside the working directory:

- **Run journal key** (`$SWENY_STATE_DIR/run-keys/`, default `~/.local/state/sweny/run-keys/`, file mode `0600`): 32 random bytes per journaled run that authenticate its journal records. The file name is a hash of the working directory path plus the run id. Deleted when its journal is pruned.
- **Version check cache** (`$XDG_CACHE_HOME/sweny/version-check.json`, default `~/.cache/sweny/`): the latest published version and when it was checked.
- **PR comment file**, only with `--comment-file <path>` (the Action sets it on pull requests): metadata only, no prompts, tool inputs or model output.
- **GitHub step summary**, only under GitHub Actions: the run receipt and a status-colored workflow diagram, appended to `$GITHUB_STEP_SUMMARY`. No node output.

Redaction (journal and final answer): string values under secret-looking keys (`token`, `secret`, `password`, `api_key`, ...), known token shapes, and the values of secret-named environment variables and skill credentials are replaced with `[redacted]`.

## What we DO do (only when you opt in)

> **Not currently available.** The hosted reporting service is in active development and there is no way to mint a `SWENY_CLOUD_TOKEN` today. Without a token this code path returns immediately and no request is made. The behavior below is documented because the code ships in the CLI, not because the service is open.

If you set `SWENY_CLOUD_TOKEN`, run summaries are sent to `https://cloud.sweny.ai/api/report`:

- Repository owner and name
- Workflow name, status, duration
- Investigation findings your workflow generated (summaries, not source code)
- PR / issue URLs the workflow created
- Per-node execution status
- Action version + runner OS

Authentication is via your project token only. Your `GITHUB_TOKEN` is never sent.

To disable at any time, remove `SWENY_CLOUD_TOKEN` from your workflow. Reporting will immediately stop.

## Pointing reporting elsewhere

`SWENY_CLOUD_URL=https://your-own-host` overrides the reporting endpoint, so you can send run summaries to your own service instead. The payload shape is the list above.
