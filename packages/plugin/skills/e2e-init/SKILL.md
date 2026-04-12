---
description: Generate agent-driven browser E2E test workflows interactively. Creates test files in .sweny/e2e/.
disable-model-invocation: true
---

# SWEny E2E Init

This command runs an interactive wizard that generates browser-based end-to-end test workflows.

**This is an interactive terminal command.** It uses prompts that require direct user input, so it cannot be run via the Bash tool. Ask the user to run it directly:

> Run `! sweny e2e init` in this session to start the E2E test wizard.

The wizard will prompt for:
1. **Test flow types** — registration, login, purchase, onboarding, upgrade, cancellation, or custom
2. **Base URL** — the application URL to test against
3. **Cleanup backend** — optional (Supabase, Firebase, or Postgres) for cleaning up test data

Generated workflow files are saved to `.sweny/e2e/`. After generation, use `/sweny:e2e-run` to execute them.
