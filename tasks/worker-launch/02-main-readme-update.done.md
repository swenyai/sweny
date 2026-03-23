# Task 02 — Add worker to main `README.md`

## Goal

Update the root `README.md` to include `@sweny-ai/worker` in the package table and
update the architecture diagram to reflect the worker's role.

## Current state

The package table in `README.md` lists 7 packages but is missing the worker:

```md
| **[@sweny-ai/engine](packages/engine)** | Workflow engine — DAG runner, ... |
| **[@sweny-ai/cli](packages/cli)**        | CLI — run triage and implement ... |
| **[SWEny Triage](#sweny-triage)**        | GitHub Action — autonomous SRE triage |
| **[@sweny-ai/providers](packages/providers)** | 30+ provider implementations |
| **[@sweny-ai/agent](packages/agent)**    | AI assistant — Slack bot + CLI |
| **[@sweny-ai/studio](packages/studio)**  | Visual workflow editor ... |
| **[@sweny-ai/web](packages/web)**        | sweny.ai website |
```

## Changes required

1. **Package table** — add one row:
   ```md
   | **[@sweny-ai/worker](packages/worker)** | Self-hosted job executor — BYO Worker for audit and VPC isolation |
   ```
   Insert it after the `@sweny-ai/cli` row (it's an execution runtime like CLI).

2. **Architecture diagram / "How It Works" section** — the ASCII diagram currently shows:
   ```
   Entry Points: GitHub Action · Slack Bot · CLI · Cloud
   ```
   Update to:
   ```
   Entry Points: GitHub Action · Slack Bot · CLI · Cloud · BYO Worker
   ```

3. **No other changes** — don't rewrite sections, don't add new sections.
   Keep the diff minimal.

## File

`README.md` at repo root.

## Acceptance criteria

- [ ] `@sweny-ai/worker` appears in the package table with a link to `packages/worker`
- [ ] Architecture entry point line includes BYO Worker
- [ ] No other content changed
