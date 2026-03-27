---
title: Troubleshooting
description: Common issues and how to resolve them.
---

## Authentication errors

**Symptom:** `API request failed (HTTP 401)` or `API request failed (HTTP 403)` in workflow logs.

**Causes:**

- Token has expired or been revoked
- Token lacks the required scopes
- Wrong token for the provider (e.g., `DD_API_KEY` in the `DD_APP_KEY` field)

**Fix:**

1. Verify the token is set in your environment (GitHub Actions secrets or `.env` for CLI)
2. Check that the token has the required permissions:
   - **GitHub** — `repo`, `issues`, `pull-requests` scopes
   - **Linear** — API key with write access
   - **Sentry** — auth token with `project:read`, `event:read`, `issue:read` scopes
   - **Datadog** — both `DD_API_KEY` and `DD_APP_KEY` are required (they are different keys)
3. Regenerate the token if it has expired

:::note[Claude authentication]
SWEny requires either `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`. The OAuth token uses your Claude Max subscription (predictable monthly cost). The API key uses per-token billing. Set one, not both.
:::

## "Missing required config" error

**Symptom:** `Missing required config: github.GITHUB_TOKEN (env: GITHUB_TOKEN)` at startup.

**Cause:** The workflow references a skill whose required environment variables are not set.

**Fix:**

- Run `sweny check` (CLI) to see which skills are configured and which are missing credentials
- Set the missing environment variables in your `.env` file or GitHub Actions secrets
- If you don't need a particular skill, use a workflow that doesn't reference it

## Workflow validation failures

**Symptom:** `Entry node "X" not found` or `Edge references unknown node: "Y"`.

**Cause:** The workflow YAML has a structural error — a typo in a node ID, an edge pointing to a non-existent node, or a missing `entry` field.

**Fix:**

```bash
sweny workflow validate my-workflow.yaml
```

This reports all structural errors: unknown node references, missing entry node, and edges pointing to non-existent nodes. Fix the YAML and re-validate.

## Node timeouts

**Symptom:** A node runs for a long time and eventually fails, or the GitHub Actions job hits its timeout.

**Cause:** The Claude agent is taking too many turns on a complex task, or the task itself is too broad.

**Fix:**

- Increase turn limits:
  - `max-investigate-turns` (default: 50) — for investigation nodes
  - `max-implement-turns` (default: 30) — for implementation nodes
- Narrow the scope:
  - Use `service-filter` to limit which services are analyzed
  - Use `time-range` to reduce the log window (e.g., `4h` instead of `24h`)
  - Use `investigation-depth: quick` for faster but less thorough analysis
- Increase the GitHub Actions job timeout: `timeout-minutes: 90`

## Rate limiting

**Symptom:** `HTTP 429` errors from observability or issue tracker APIs.

**Cause:** The Claude agent is making too many API calls in a short period. Observability APIs (Datadog, Sentry, New Relic) often have stricter rate limits than other services.

**Fix:**

- Reduce `investigation-depth` from `thorough` to `standard` or `quick`
- Narrow `time-range` to reduce the volume of data queried
- Use `service-filter` to limit the scope
- For Datadog, verify your API key tier supports the request volume

## MCP server connection failures

**Symptom:** `MCP server failed to start` or `Connection refused` errors in logs.

**Causes:**

- **stdio servers** — the npm package failed to install or the command is not found
- **HTTP servers** — the endpoint is unreachable or the authentication headers are wrong

**Fix for stdio servers:**

1. Test the server locally: `npx -y @modelcontextprotocol/server-github@latest`
2. Check that the GitHub Actions runner has network access to npm
3. Verify the `env` values are correct (e.g., `GITHUB_PERSONAL_ACCESS_TOKEN` for the GitHub MCP server, not `GITHUB_TOKEN`)

**Fix for HTTP servers:**

1. Verify the URL is correct (some servers require a trailing path like `/mcp`)
2. Check authentication headers — each server has its own format:
   - Linear: `Authorization: Bearer <token>`
   - Datadog: `DD_API_KEY` and `DD_APPLICATION_KEY` as headers
   - PagerDuty: `Authorization: Token token=<key>`
   - New Relic: `Api-Key: <key>` (not `Authorization`)
3. Check if the service has a status page for outages

## GitHub Actions permissions

**Symptom:** `Resource not accessible by integration` or `403` when creating PRs or issues.

**Fix:** Add the required permissions to your workflow file:

```yaml
permissions:
  contents: write        # Create branches and push commits
  pull-requests: write   # Open pull requests
  issues: write          # Create issues (when using github-issues tracker)
```

For cross-repo dispatch (when the fix belongs to a different repository), use a `bot-token` with `repo` and `actions` scopes instead of the default `GITHUB_TOKEN`:

```yaml
- uses: swenyai/sweny@v4
  with:
    bot-token: ${{ secrets.BOT_TOKEN }}
```

## Dry run produces no output

**Symptom:** `sweny triage --dry-run` runs but you see no investigation report.

**Causes:**

- No errors found in the configured time range
- The observability provider credentials are valid but the service/index/log group has no data
- `severity-focus` is set to `errors` but the logs only contain warnings

**Fix:**

- Widen the time range: `--time-range 7d`
- Change severity focus: `--severity-focus all`
- Remove the service filter: `--service-filter '*'`
- Check the raw API response by running `sweny check` to verify the provider can connect and return data

## "No configured skills" warning

**Symptom:** `Workflow references unregistered skill: "X"` warnings at startup, followed by a node failing.

**Cause:** The environment variables for a skill are not set, so the skill was not registered.

**Fix:**

Run `sweny check` to see which skills are detected:

```bash
sweny check
```

This lists every built-in skill and shows which ones have their credentials configured. Set the missing environment variables for the skills your workflow needs.

## Claude produces unexpected results

**Symptom:** The investigation is shallow, the implementation misses the point, or the PR changes the wrong files.

**Fix:**

- Add `additional-instructions` to guide Claude:
  ```yaml
  additional-instructions: "Focus on the payment webhook handler. The error is likely in src/webhooks/stripe.ts."
  ```
- Use `investigation-depth: thorough` for deeper analysis
- Check that the correct skills are available at the relevant node — Claude can only use tools from the node's declared skills
- Review the execution events in the GitHub Actions log or Studio to see what tools Claude called and what data it received
