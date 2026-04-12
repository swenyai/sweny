---
description: Create a new SWEny workflow in the current project. Unified interactive picker for templates, AI-generated workflows, and end-to-end browser tests.
disable-model-invocation: true
---

# SWEny New

Create a new SWEny workflow. This runs an interactive wizard that walks through:

1. **Pick a workflow** — choose a template (triage, implement, etc.), describe your own in natural language, select end-to-end browser testing, or start blank
2. **Infer providers** — source control, issue tracker, observability are inferred from the workflow's skills and your git remote
3. **Collect credentials** — only asks for the keys the chosen workflow actually needs
4. **Write files** — `.sweny.yml`, `.env`, and `.sweny/workflows/<id>.yml`

The command is idempotent: re-running it in a repo that already has `.sweny.yml` adds a new workflow without touching existing config. `.env` is append-only (new keys are added, existing ones are left alone).

**This is an interactive terminal command.** Ask the user to run it directly:

> Run `! sweny new` in this session to start the workflow creation wizard.

After creation:
- Run `/sweny:check` to verify credentials are working
- Run `/sweny:workflow-run` to execute the new workflow
- Run `/sweny:workflow-diagram` to visualize it
