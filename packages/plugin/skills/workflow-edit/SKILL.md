---
name: workflow-edit
description: Edit an existing SWEny workflow using natural language instructions.
allowed-tools: Bash
argument-hint: "<file> [instruction]"
---

# SWEny Workflow Edit

Edit an existing workflow file using natural language instructions. The CLI applies the changes using Claude.

## Usage

Use `--json` mode for non-interactive editing:

```bash
sweny workflow edit $ARGUMENTS --json
```

This outputs the updated workflow JSON to stdout. To update the file in place, pipe the output back:

```bash
sweny workflow edit .sweny/workflows/my-workflow.yml "add a notification step at the end" --json > /tmp/updated.yml && mv /tmp/updated.yml .sweny/workflows/my-workflow.yml
```

If the user wants an interactive refinement loop, ask them to run it directly:

> Run `! sweny workflow edit <file> "your instruction"` for interactive editing with a refinement loop.
