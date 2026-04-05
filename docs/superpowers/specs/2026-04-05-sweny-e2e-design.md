# SWEny E2E Testing — Design Spec

## Goal

Add `sweny e2e init` and `sweny e2e run` commands to `@sweny-ai/core` so users can generate and execute agent-driven end-to-end tests for any web application. No browser skill in core — the AI agent drives `agent-browser` directly via shell commands, installing it if missing.

## Architecture

Two CLI commands, no new library code, no new skills, no daemon management.

```
sweny e2e init          # Wizard → generates .sweny/e2e/*.yml + .env vars
sweny e2e run           # Loads .sweny/e2e/*.yml → execute() → exit code
sweny e2e run --file x  # Run a specific workflow file
```

### File Layout

| Component | Location | Purpose |
|-----------|----------|---------|
| `e2e init` wizard | `packages/core/src/cli/e2e.ts` | @clack/prompts flow-type wizard |
| `e2e run` command | `packages/core/src/cli/e2e.ts` | Load YAML, replace template vars, execute, report |
| Flow templates | Embedded in `e2e.ts` | Proven agent-browser instruction patterns per flow type |
| CLI wiring | `packages/core/src/cli/main.ts` | `sweny e2e init` / `sweny e2e run` subcommands |

### What Does NOT Ship

- No browser skill in core — agent uses `agent-browser` CLI directly via bash
- No daemon lifecycle management — agent handles it from workflow instructions
- No cleanup framework — cleanup is an optional workflow node with natural language instructions
- No new npm dependencies (reuses @clack/prompts from `sweny init`)

## `sweny e2e init` Wizard

Seven-screen @clack/prompts wizard, same pattern as `sweny init`.

### Screen 1 — Intro

> "Let's set up end-to-end testing for your app."

### Screen 2 — Flow Type Selector (multi-select)

- Registration / Signup
- Login / Auth
- Purchase / Checkout
- Onboarding
- User upgrade / Plan change
- Cancellation
- Custom (describe it)

### Screen 3 — Per-Flow Follow-ups

Loop through each selected flow with 3-5 targeted questions:

**Registration:** Signup URL path, required fields (name/email/password/other), email verification (yes/no), success redirect path.

**Login:** Login URL path, credentials source (from .env or created during test).

**Purchase:** Pricing page path, payment provider (Stripe/other), what constitutes success (redirect to checkout, confirmation page, etc.).

**Onboarding:** Onboarding start path, number of steps, success criteria.

**Upgrade:** Upgrade/plan page path, what plan to select, success criteria.

**Cancellation:** Cancel page path, confirmation step details, success criteria.

**Custom:** Describe the flow in a sentence or two, starting URL path, success criteria.

### Screen 4 — Base URL

> "What's the app URL for testing?" (default: `http://localhost:3000`)

### Screen 5 — Cleanup

> "Auto-cleanup test data after runs?"

If yes: "What's your backend?" → Supabase / Firebase / Postgres / API / Other

Adds required env vars (e.g., `SUPABASE_SERVICE_ROLE_KEY`) and generates a cleanup node with natural language instructions for the agent.

### Screen 6 — Summary

Shows what will be generated: which files, which env vars needed.

### Screen 7 — Write Files

- `.sweny/e2e/<flow-name>.yml` — one file per selected flow. When multiple flows share auth (e.g., purchase needs login), the login node is duplicated into each file so workflows are self-contained and can run independently.
- Appends new env vars to `.env`
- Shows next steps: "Fill in your .env values, then run `sweny e2e run`"

## Generated Workflow YAML

### Structure

Every generated workflow follows this pattern:

```yaml
id: e2e-registration
name: "E2E: Registration"
description: Verify new user registration flow
entry: setup

nodes:
  setup:
    name: Browser Setup
    instruction: |-
      You need the agent-browser CLI for browser automation.
      Check if it's installed: which agent-browser
      If not: npm install -g @anthropic-ai/agent-browser

      Start the daemon: agent-browser &
      Wait for it to be ready by polling: agent-browser get url
      (retry every 2 seconds, up to 30 seconds)

      Once ready, navigate to {base_url}/signup
      Run: agent-browser open {base_url}/signup
      Then take a snapshot: agent-browser snapshot

      The snapshot shows an accessibility tree with element refs
      like @e1, @e2. You'll use these refs in subsequent commands.
    output:
      type: object
      properties:
        status:
          type: string
          enum: [ready, fail]
      required: [status]

  register:
    name: "Test: Register New User"
    instruction: |-
      Fill the registration form and submit.

      1. Run: agent-browser snapshot
      2. Find the email input and fill it:
         agent-browser fill @<ref> "e2e-{run_id}@yourapp.test"
      3. Find the password input and fill it:
         agent-browser fill @<ref> "{test_password}"
      4. Find the name input and fill it:
         agent-browser fill @<ref> "E2E Test User"
      5. Click the submit/signup button:
         agent-browser click @<ref>
      6. Wait 3 seconds, then snapshot again
      7. Check the URL: agent-browser get url

      Success: URL contains /dashboard or /welcome
      Failure: still on /signup or error visible in snapshot

      Take a screenshot as evidence:
      agent-browser screenshot results/register-result.png
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
      Compile results from all test nodes.
      For each test, report status (pass/fail) and any errors.
      Count total passed and failed.
    output:
      type: object
      properties:
        total:
          type: number
        passed:
          type: number
        failed:
          type: number
        summary:
          type: string
      required: [total, passed, failed, summary]

edges:
  - from: setup
    to: register
    when: "setup status is ready"
  - from: setup
    to: report
    when: "setup status is fail"
  - from: register
    to: report
```

### Template Variables

All auto-generated — no `.env` entries needed for credentials:

| Variable | Source |
|----------|--------|
| `{base_url}` | `E2E_BASE_URL` env var |
| `{run_id}` | Auto-generated timestamp |
| `{test_email}` | Auto-generated: `e2e-{run_id}@yourapp.test` |
| `{test_password}` | Auto-generated: `E2eTest!{run_id}` |
| Custom vars | `E2E_*` env vars map to `{var_name}` |

The naming convention enables cleanup: any record matching `e2e-*@yourapp.test` is safe to delete.

### Multi-Flow Chaining

Each selected flow generates its own self-contained `.yml` file. When a flow needs authentication (purchase, upgrade, cancel), the login node is included in that file automatically.

Example: selecting Registration + Purchase generates two independent files:
- `.sweny/e2e/registration.yml` — setup → register → report
- `.sweny/e2e/purchase.yml` — setup → login → purchase → report

`sweny e2e run` executes all files sequentially. Each workflow is independent and can also be run individually with `--file`.

### Cleanup Node (Optional)

Appended between the last test node and report. Always runs — edges from both pass and fail paths route through cleanup before report.

Instructions are generated based on backend selection:

**Supabase example:**
> "Delete test users matching `e2e-*@yourapp.test` using the Supabase Auth Admin API. Service role key is available in your environment as `SUPABASE_SERVICE_ROLE_KEY`."

**Generic example:**
> "Delete any test data created during this run. Look for records matching the pattern `e2e-{run_id}`."

## `sweny e2e run` Command

### Behavior

1. Discover workflow files: glob `.sweny/e2e/*.yml` (or use `--file`)
2. Load `.env` from project root (standard dotenv)
3. Replace template variables in all node instructions
4. Call `execute()` per workflow with `ClaudeClient` + `consoleLogger`
5. Print results summary
6. Exit code 0 if all pass, 1 if any fail

### Run All Mode (default)

`sweny e2e run` executes every `.yml` in `.sweny/e2e/` sequentially:

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

▶ purchase.yml
  ▶ setup... ✅ ready (2.1s)
  ▶ login... ✅ pass (8.3s)
  ▶ purchase... ✅ pass (15.7s)
  ▶ report... ✅ done (1.0s)

Results: 2/2 workflows passed
```

### Timeout

- Default: 15 minutes per workflow
- Override: `--timeout <ms>`
- Uses `withTimeout()` wrapper around `execute()`

### Template Variable Resolution

```typescript
function resolveTemplateVars(instruction: string, vars: Record<string, string>): string {
  return instruction.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
}
```

Variables built from:
1. `run_id` — `Date.now().toString()` or `RUN_ID` env var
2. `base_url` — `E2E_BASE_URL` env var
3. `test_email` — `e2e-${runId}@yourapp.test`
4. `test_password` — `E2eTest!${runId}`
5. Any `E2E_*` env var (stripped of prefix, lowercased)

## Flow Type Templates

The wizard's core value — proven instruction patterns per flow type.

### Templates for v1

| Flow Type | Nodes Generated | Key Details |
|-----------|----------------|-------------|
| Registration | setup → register → report | Auto-generated credentials, form fill, redirect check |
| Login | setup → login → report | Credentials from .env or auto-generated |
| Purchase | setup → login → purchase → report | Navigate to pricing, click plan, verify checkout redirect |
| Onboarding | setup → login → onboarding → report | Multi-step form/wizard navigation |
| Upgrade | setup → login → upgrade → report | Plan selection, confirmation |
| Cancellation | setup → login → cancel → report | Cancel flow, confirmation dialog |
| Custom | setup → custom_step → report | User-provided description as instructions |

### Template Structure

Each template is a function that takes wizard answers and returns workflow YAML:

```typescript
interface FlowTemplate {
  id: string;
  name: string;
  questions: ClackQuestion[];  // Flow-specific follow-up questions
  generate(answers: FlowAnswers): WorkflowYaml;
}
```

The setup node is shared across all templates — identical agent-browser bootstrap instructions. Only the test nodes differ per flow type.

## Output Files

### `.sweny/e2e/<flow-name>.yml`

Generated workflow YAML with app-specific instructions.

### `.env` additions

Only added when cleanup is enabled:

```env
# E2E Testing
E2E_BASE_URL=http://localhost:3000
# Cleanup (if Supabase selected)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

`E2E_BASE_URL` is always added. Backend-specific vars only when cleanup is opted in.

## Integration with Existing CLI

New `e2e` command group in `packages/core/src/cli/main.ts`:

```
sweny e2e init          # Run the wizard
sweny e2e run           # Run all .sweny/e2e/*.yml
sweny e2e run --file f  # Run a specific file
```

Follows the same pattern as `sweny workflow run`, `sweny workflow list`, etc.

## Out of Scope (v1)

- No browser skill in core
- No daemon lifecycle management
- No parallel test execution
- No pluggable browser backends (Playwright, Puppeteer)
- No test data factory system
- No CI-specific GitHub Action workflow generation (future: `sweny init` refactor will handle this)
- No AI-powered codebase discovery (future: let AI explore schema for cleanup instructions)
