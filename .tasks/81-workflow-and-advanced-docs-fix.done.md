# Task 81: Fix workflow docs and advanced docs action references

## Problem

Several docs pages outside the action/ section show `swenyai/sweny@v5` with triage-specific inputs.

## Files and changes

### 1. `packages/web/src/content/docs/workflows/triage.md` (line 250)
Shows `swenyai/sweny@v5` in a GitHub Action deploy example. This is specifically about the triage workflow, so change to `swenyai/triage@v1`.

### 2. `packages/web/src/content/docs/workflows/implement.md` (line 181)
Shows `swenyai/sweny@v5` with `workflow: implement` and `linear-api-key`. The implement workflow is part of the triage action. Change to `swenyai/triage@v1`.

### 3. `packages/web/src/content/docs/advanced/mcp-servers.md` (lines 48, 70)
Two code blocks showing `swenyai/sweny@v5` with `workspace-tools` and other triage inputs. Change to `swenyai/triage@v1`.

### 4. `packages/web/src/content/docs/advanced/troubleshooting.md` (line 127)
Shows `swenyai/sweny@v5` with `bot-token`. The `bot-token` input is on triage, not the generic runner. Change to `swenyai/triage@v1`.

### 5. `packages/web/src/content/docs/cloud/getting-started.mdx` (line 51)
Shows `swenyai/sweny@v5` with just `anthropic-api-key`. Check if this example is for generic workflow running or triage — if triage, switch to `swenyai/triage@v1`. If generic, add a `workflow:` input.

## Validation

After editing, grep all docs for `swenyai/sweny@v5` — every remaining instance should only appear alongside the `workflow:` input (the generic runner pattern), never with triage inputs.
