# Task: Write CLI Section (3 pages)

## Goal
Write the 3 CLI pages. The CLI is for local development and testing workflows.

## Pages to write

All pages go in `packages/web/src/content/docs/cli/`.

### 1. `index.md` — Quick Start
- Install: `npm install -g @sweny-ai/cli` (or `npx @sweny-ai/cli`)
- The actual binary name is `sweny`
- First run: `sweny init` creates a starter `.sweny.yml`
- Config file (`.sweny.yml`) + `.env` for secrets
- Run triage: `sweny triage` — shows live DAG rendering with status icons (● completed, ◉ running, ○ pending, ✕ failed)
- Run implement: `sweny implement ENG-123`
- Check credentials: `sweny check`
- Interactive setup: `sweny setup`
- The CLI auto-loads `.env` files

### 2. `commands.md` — Commands Reference
Full reference for all CLI commands:

- **`sweny init`**: Create starter `.sweny.yml` config file
- **`sweny check`**: Verify provider credentials and connectivity
- **`sweny setup`**: Interactive setup wizard
- **`sweny triage [options]`**: Run triage workflow
  - Options: `--dry-run`, `--json`, `--time-range`, `--severity-focus`, `--service-filter`, `--investigation-depth`, `--max-investigate-turns`, `--review-mode`, `--novelty-mode`, `--bell`, etc.
- **`sweny implement <issueId> [options]`**: Run implement workflow for a specific issue
  - Options: `--dry-run`, `--max-implement-turns`, `--base-branch`, etc.
- **`sweny workflow validate <file>`**: Validate a workflow YAML/JSON file
  - Options: `--json`
- **`sweny workflow run <file>`**: Execute a custom workflow file
  - Options: `--dry-run`, `--json`
- **`sweny workflow export <name>`**: Print a built-in workflow as YAML (`triage` or `implement`)
- **`sweny workflow create <description>`**: Generate a new workflow from natural language
  - Options: `--json`
  - Interactive: shows DAG preview, save/refine/discard
- **`sweny workflow edit <file> [instruction]`**: Edit an existing workflow with natural language
  - Options: `--json`
  - Interactive: shows updated DAG, save/refine/discard
- **`sweny workflow list`**: List configured skills
  - Options: `--json`

### 3. `examples.md` — Examples
- Local triage with Sentry: `SENTRY_AUTH_TOKEN=... sweny triage --time-range 6h`
- Dry run (analyze only): `sweny triage --dry-run`
- JSON output for scripting: `sweny triage --json | jq .`
- Run a custom workflow: `sweny workflow run my-workflow.yml`
- Generate a workflow from a prompt: `sweny workflow create "check for slow database queries and file tickets"`
- Edit a workflow: `sweny workflow edit my-workflow.yml "add a Slack notification after creating tickets"`
- Export built-in workflow for customization: `sweny workflow export triage > my-triage.yml`
- Implement from a Linear issue: `sweny implement ENG-456`

## Source of truth
- `packages/core/src/cli/main.ts` — all commands and options
- `packages/core/src/cli/config.ts` — CLI option definitions
- `packages/core/src/cli/renderer.ts` — DAG rendering
- `packages/core/src/cli/config-file.ts` — .sweny.yml loading
