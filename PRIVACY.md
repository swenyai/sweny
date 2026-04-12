# SWEny Privacy

SWEny is an open-source CLI and GitHub Action. It does not collect telemetry by default.

## What we do NOT do

- No anonymous usage telemetry
- No crash reporting phone-home
- No reading or exfiltrating your code
- No forwarding of `GITHUB_TOKEN` to any third party

## What we DO do (only when you opt in)

If you set `SWENY_CLOUD_TOKEN`, run summaries are sent to `https://cloud.sweny.ai/api/report`:

- Repository owner and name
- Workflow name, status, duration
- Investigation findings your workflow generated (summaries, not source code)
- PR / issue URLs the workflow created
- Per-node execution status
- Action version + runner OS

Authentication is via your project token only. Your `GITHUB_TOKEN` is never sent.

To disable at any time, remove `SWENY_CLOUD_TOKEN` from your workflow. Reporting will immediately stop.

## Self-hosting

Override the reporting endpoint with `SWENY_CLOUD_URL=https://your-own-host` if you run your own SWEny Cloud instance.
