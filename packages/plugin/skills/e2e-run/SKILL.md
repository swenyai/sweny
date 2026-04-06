---
name: e2e-run
description: Run SWEny E2E browser test workflows from .sweny/e2e/. Use when the user wants to execute end-to-end tests.
disable-model-invocation: true
allowed-tools: Bash
context: fork
agent: sweny-workflow
argument-hint: [file] [--timeout <ms>]
---

# SWEny E2E Run

Run agent-driven browser end-to-end tests. Executes workflow files from `.sweny/e2e/`.

**Prerequisites:** E2E workflows must exist in `.sweny/e2e/`. Run `/sweny:e2e-init` first if the directory is empty.

## Usage

Run all E2E tests:

```bash
sweny e2e run
```

Run a specific test file:

```bash
sweny e2e run $ARGUMENTS
```

With a custom timeout (default is 15 minutes per workflow):

```bash
sweny e2e run --timeout 300000
```

## What to expect

- Each test workflow takes 1-15 minutes depending on flow complexity
- Tests use agent-browser for accessibility-tree-based browser automation (not screenshots)
- On completion, report: pass/fail status for each flow, any errors encountered
- Test data matching `e2e-{run_id}` patterns is automatically cleaned up if a cleanup backend is configured

## Environment variables

- `E2E_BASE_URL` — override the base URL for tests
- `E2E_EMAIL` — override test email (default: e2e-{run_id}@yourapp.test)
- `E2E_PASSWORD` — override test password
