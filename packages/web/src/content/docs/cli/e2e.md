---
title: E2E Testing
description: Generate and run AI-driven end-to-end browser tests for any web app — no test scripts to write.
---

SWEny E2E generates workflow-based browser tests from a quick interactive wizard, then runs them with an AI agent that drives a real browser. No Playwright scripts, no Selenium config — describe your flows, and the agent figures out the DOM.

## How it works

1. `sweny e2e init` — interactive wizard asks about your app's flows (registration, login, purchase, etc.) and generates workflow YAML files
2. `sweny e2e run` — loads the generated workflows, resolves template variables, and executes them with an AI agent driving `agent-browser`

Each generated workflow is a self-contained DAG:

```
setup → test node(s) → [cleanup] → report
```

The setup node installs and starts the browser daemon. Test nodes contain natural language instructions for the agent to navigate your app and verify behavior. An optional cleanup node removes test data.

## Quick start

```bash
# 1. Run the wizard
sweny e2e init

# 2. Fill in any .env values (base URL, cleanup credentials)

# 3. Run all tests
sweny e2e run
```

## The wizard

`sweny e2e init` walks you through 7 screens:

**Flow types** — pick which flows to test:

| Flow | What it tests |
|------|---------------|
| Registration | Signup form with auto-generated test credentials |
| Login | Authentication with existing credentials |
| Purchase | Pricing → checkout (includes login) |
| Onboarding | Multi-step wizard after login |
| Upgrade | Plan change flow after login |
| Cancellation | Cancel/downgrade flow after login |
| Custom | Any flow you describe in a sentence |

**Per-flow details** — URL paths, form fields, success criteria, payment providers.

**Base URL** — your app's URL for testing (default: `http://localhost:3000`).

**Cleanup** — optionally auto-delete test data after runs. Supports Supabase, Firebase, Postgres, API, or custom backends.

The wizard generates:
- `.sweny/e2e/<flow-name>.yml` — one workflow file per selected flow
- `.env` additions — `E2E_BASE_URL` and any cleanup credentials

## Template variables

Generated workflows use template variables that are auto-resolved at runtime:

| Variable | Source | Example |
|----------|--------|---------|
| `{base_url}` | `E2E_BASE_URL` env var | `http://localhost:3000` |
| `{run_id}` | Auto-generated timestamp or `RUN_ID` env var | `1712345678` |
| `{test_email}` | Auto-generated from run_id | `e2e-1712345678@yourapp.test` |
| `{test_password}` | Auto-generated from run_id | `E2eTest!1712345678` |
| `{email}` | `E2E_EMAIL` env var (falls back to test_email) | `test@example.com` |
| `{password}` | `E2E_PASSWORD` env var (falls back to test_password) | `secret` |
| `{*}` | Any `E2E_*` env var (prefix stripped, lowercased) | `E2E_API_KEY` → `{api_key}` |

The naming convention `e2e-*@yourapp.test` makes cleanup safe — anything matching that pattern is test data.

## Running tests

```bash
# Run all .sweny/e2e/*.yml files sequentially
sweny e2e run

# Run a specific workflow
sweny e2e run registration.yml

# Custom timeout (default: 15 minutes per workflow)
sweny e2e run --timeout 300000
```

Output:

```
─────────────────────────────────────
E2E Test Run
  Target:  http://localhost:3000
  Run ID:  1712345678
─────────────────────────────────────

▶ registration.yml
  ▶ setup... ✅ ready (3.2s)
  ▶ register... ✅ pass (12.4s)
  ▶ report... ✅ done (1.1s)

Results: 1/1 workflows passed
```

Exit code `0` if all pass, `1` if any fail — CI-friendly out of the box.

## Auth-dependent flows

Flows that need a logged-in user (purchase, onboarding, upgrade, cancellation) automatically include a login node before the test node. Each workflow is self-contained — a purchase workflow includes its own login step so it can run independently.

## Cleanup

When cleanup is enabled in the wizard, a cleanup node runs between the last test and the report. Instructions are generated based on your backend:

- **Supabase** — delete test users via Auth Admin API using `SUPABASE_SERVICE_ROLE_KEY`
- **Firebase** — delete test users via Firebase Admin SDK
- **Postgres** — delete test records matching `e2e-{run_id}` pattern
- **Other** — generic instructions for the agent to clean up

## Generated workflow example

```yaml
id: e2e-registration
name: "E2E: Registration"
description: End-to-end test for registration flow
entry: setup

nodes:
  setup:
    name: Browser Setup
    instruction: |-
      Install agent-browser if missing, start the daemon,
      poll until ready, then navigate to {base_url}/signup.
    output:
      type: object
      properties:
        status:
          type: string
          enum: [ready, fail]
      required: [status]

  test_registration:
    name: "Test: Registration"
    instruction: |-
      Fill the registration form with {test_email} and
      {test_password}, submit, and verify redirect to /dashboard.
    output:
      type: object
      properties:
        status:
          type: string
          enum: [pass, fail]
        error:
          type: string
      required: [status]

  report:
    name: Test Report
    instruction: |-
      Compile results from test_registration.
      Report pass/fail counts and any errors.

edges:
  - from: setup
    to: test_registration
    when: "setup status is ready"
  - from: setup
    to: report
    when: "setup status is fail"
  - from: test_registration
    to: report
```

## What's next

- [Commands Reference](/cli/commands/) — full flag reference for `sweny e2e`
- [Custom Workflows](/workflows/custom/) — build non-E2E workflows from natural language
- [GitHub Action](/action/) — run E2E workflows in CI
