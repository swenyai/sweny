---
name: workflow-create
description: Generate a new SWEny workflow from a natural language description. Saves to .sweny/workflows/.
allowed-tools: Bash
argument-hint: "<description>"
---

# SWEny Workflow Create

Generate a new DAG workflow from a natural language description. The CLI uses Claude to design the workflow, then saves it as YAML.

## Usage

Use `--json` mode for non-interactive generation:

```bash
sweny workflow create "$ARGUMENTS" --json
```

This outputs the workflow JSON to stdout without interactive prompts. Save the result:

```bash
sweny workflow create "$ARGUMENTS" --json > .sweny/workflows/new-workflow.yml
```

If the user wants an interactive refinement loop with visualization, ask them to run it directly:

> Run `! sweny workflow create "your description"` for interactive workflow creation with a refinement loop.

## After creation

- The workflow is saved to `.sweny/workflows/{id}.yml`
- Use `/sweny:workflow-diagram` to visualize it
- Use `/sweny:workflow-run` to execute it
- Use `/sweny:workflow-edit` to refine it
