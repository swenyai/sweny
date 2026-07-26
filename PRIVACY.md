# SWEny Privacy

SWEny is an open-source CLI and GitHub Action. It does not collect telemetry by default.

## What we do NOT do

- No anonymous usage telemetry
- No crash reporting phone-home
- No reading or exfiltrating your code
- No forwarding of `GITHUB_TOKEN` to any third party

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
