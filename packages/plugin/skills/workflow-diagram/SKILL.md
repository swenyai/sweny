---
name: workflow-diagram
description: Render a SWEny workflow as a Mermaid diagram for visualization.
allowed-tools: Bash
argument-hint: <file> [--direction TB|LR]
---

# SWEny Workflow Diagram

Render a workflow file as a Mermaid diagram. Useful for visualizing workflow structure, node connections, and conditional edges.

## Usage

```bash
sweny workflow diagram $ARGUMENTS
```

The output is a Mermaid diagram wrapped in a code fence. Present it directly to the user — Claude Code renders Mermaid natively.

## Options

- `--direction TB` — top-to-bottom layout (default)
- `--direction LR` — left-to-right layout
- `--title <title>` — custom diagram title
- `--no-block` — output raw Mermaid without code fence
