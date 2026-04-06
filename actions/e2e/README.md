# SWEny — E2E Agent Suite Action

GitHub Action for running agentic end-to-end tests against a deployed app using a SWEny workflow.

This action builds on [`actions/run`](../run) and adds:
- Installation of [`agent-browser`](https://www.npmjs.com/package/agent-browser) (accessibility-tree based browser automation, which agents drive via shell).
- A `BASE_URL` env var convention for pointing the workflow at a deployed environment.
- Automatic upload of screenshots / artifacts after the run (success or failure).

The workflow YAML you provide is responsible for the actual test scenarios — this action just runs it with the right tools installed.

## Usage

```yaml
name: E2E UAT
on:
  workflow_run:
    workflows: ["Deploy to Staging"]
    types: [completed]

jobs:
  e2e:
    runs-on: macos-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: swenyai/sweny/actions/e2e@v5
        with:
          workflow: .sweny/e2e/uat.yml
          base-url: https://staging.example.com
          claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
        env:
          # Anything your workflow needs for provisioning, auth, cleanup, etc.
          AUTH0_M2M_CLIENT_ID: ${{ secrets.AUTH0_M2M_CLIENT_ID }}
          AUTH0_M2M_CLIENT_SECRET: ${{ secrets.AUTH0_M2M_CLIENT_SECRET }}
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `workflow` | yes | — | Path to the E2E workflow YAML file. |
| `claude-oauth-token` | one of these | — | Claude Code OAuth token. Does not consume API credit. |
| `anthropic-api-key` | one of these | — | Anthropic API key for Claude. |
| `base-url` | no | — | Base URL of the app under test. Exposed to the workflow as `BASE_URL`. |
| `cli-version` | no | `latest` | Version of `@sweny-ai/core` to install. |
| `agent-browser-version` | no | `latest` | Version of `agent-browser` to install. |
| `node-version` | no | `24` | Node.js version. |
| `working-directory` | no | `.` | Working directory to run the workflow from. |
| `screenshots-path` | no | `results/` | Path where the workflow writes screenshots. Uploaded after the run. |
| `artifact-name` | no | `e2e-screenshots` | Name of the uploaded artifact (run id is appended). |
| `artifact-retention-days` | no | `14` | How long to keep the screenshots artifact. |

You must provide either `claude-oauth-token` or `anthropic-api-key`.

## Workflow conventions

The action will:
1. Install Node, `@sweny-ai/core`, and `agent-browser`.
2. Run `agent-browser install` to set up the browser binaries.
3. Set `BASE_URL` (and `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`) in the environment.
4. Execute `sweny workflow run <workflow>`.
5. After the run (always — even on failure), upload anything under `screenshots-path` as a workflow artifact.

Inside your workflow YAML, agent nodes drive the browser by shelling out to `agent-browser` (start, click, type, screenshot, etc.). See the [SWEny docs](https://sweny.ai) for examples of agent-driven E2E patterns.

## Why a separate action?

Compared to using [`actions/run`](../run) directly:
- Saves you from the install boilerplate (`agent-browser` + `agent-browser install`).
- Standardises the `BASE_URL` convention across E2E workflows.
- Wires up the screenshots artifact upload, which you almost always want.

If you don't need any of this, [`actions/run`](../run) is simpler.

## Runner choice

E2E browser-driving workflows generally need a runner with a working desktop environment. `macos-latest` and `ubuntu-latest` both work — pick whichever matches your app's expected target.

## See also

- [`actions/run`](../run) — generic engine wrapper for any SWEny workflow.
- Root [`swenyai/sweny`](../..) action — built-in triage and implement workflows.
