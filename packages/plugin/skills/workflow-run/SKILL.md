---
name: workflow-run
description: Run a SWEny workflow from a YAML file. For custom or built-in workflows.
disable-model-invocation: true
allowed-tools: Bash
context: fork
agent: sweny-workflow
argument-hint: "<file> [--dry-run] [--input <json>]"
---

# SWEny Workflow Run

Run any SWEny workflow from a YAML or JSON file. Works with custom workflows in `.sweny/workflows/` and built-in workflow exports.

## Usage

Run a workflow file:

```bash
sweny workflow run $ARGUMENTS --stream
```

With JSON input data:

```bash
sweny workflow run .sweny/workflows/my-workflow.yml --stream --input '{"key": "value"}'
```

Dry-run (validate without executing):

```bash
sweny workflow run .sweny/workflows/my-workflow.yml --dry-run
```

## What to expect

- Execution time depends on the workflow's node count and complexity
- Progress events stream as NDJSON
- On completion, report the structured result from the final JSON output
- If `--mermaid` is passed, a Mermaid diagram with execution state is appended to output
