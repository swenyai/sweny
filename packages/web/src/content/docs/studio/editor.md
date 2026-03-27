---
title: Editor Guide
description: Build workflows visually with the Studio editor -- toolbox, canvas, properties panel, and keyboard shortcuts.
---

The Studio editor is a three-panel layout: a **node toolbox** on the left, the **canvas** in the center, and a **properties panel** on the right. The toolbar across the top provides mode switching, undo/redo, import/export, and sharing.

## Toolbox

The left sidebar contains pre-built node templates organized by category. Drag any template onto the canvas to add it as a new node with pre-configured skills and a starter instruction.

### Categories

**General** -- utility nodes for common patterns:
- **Blank Node** -- an empty node with no skills, for custom logic
- **Decision Gate** -- a routing node that evaluates context and outputs a classification for downstream edge conditions
- **Human Review** -- pause execution and send findings to Slack for approval before proceeding
- **Validate Output** -- check the previous step's results for completeness and correctness

**Observability** -- nodes for gathering and analyzing system data:
- **Gather Context** -- collect logs, errors, and metrics using GitHub, Sentry, Datadog, and BetterStack skills
- **Root Cause Analysis** -- analyze gathered context to identify the root cause, assess severity, and recommend a fix
- **Search Logs** -- query Datadog or BetterStack logs for errors and patterns in a time window
- **Check Alerts** -- review active alerts and monitors for related or correlated incidents

**Code** -- nodes for working with source code:
- **Analyze Code** -- read and understand the relevant codebase areas
- **Implement Fix** -- write and apply a code change that addresses the root cause
- **Code Review** -- review changes for correctness, style, performance, and security
- **Create PR** -- open a pull request with a clear description and linked issue

**Tasks** -- nodes for issue tracking:
- **Create Issue** -- file a ticket in Linear or GitHub with root cause, severity, and recommended fix
- **Update Issue** -- update an existing ticket with latest findings or resolution details
- **Search Issues** -- find related or duplicate issues to avoid redundant work

**Notification** -- nodes for team communication:
- **Notify Team** -- send alerts via Slack or webhook with a summary and links
- **Send Summary** -- post a comprehensive report of the workflow results
- **Escalate** -- escalate to on-call or leadership with severity and impact details

The toolbox has a search field at the top that filters templates by name, description, or skill. Categories are collapsible.

## Canvas

The center panel is the React Flow canvas where the DAG is laid out.

### Navigation

- **Pan** -- click and drag on the background, or use arrow keys
- **Zoom** -- scroll wheel, pinch gesture, or use the +/- controls in the bottom-left corner
- **Fit view** -- the canvas auto-fits when nodes are added; use the fit-view button in the controls to reset
- **Minimap** -- the bottom-right corner shows a minimap for orientation in large workflows

### Adding nodes

**Drag from toolbox** -- drag a template from the left sidebar and drop it onto the canvas. The node is created with a unique ID, pre-configured skills, and a starter instruction.

**Toolbar** -- click **+ new** in the toolbar to create a blank workflow, or **fork** to duplicate a built-in workflow for customization.

### Connecting nodes

Drag from a node's **bottom handle** (source) to another node's **top handle** (target) to create an edge. Handles appear as small circles at the top and bottom of each node.

- Edges are directional -- they flow from source to target
- Duplicate edges (same source and target) are ignored
- Self-loops are not supported

### Selecting elements

Click a node to select it and open its properties in the right panel. Click an edge to select it and edit its condition. Click the canvas background to deselect and show the workflow meta panel.

### Edge conditions

After creating an edge, select it to open the edge panel on the right. Enter a natural-language condition in the **Condition (when)** field. Leave it empty for an unconditional edge.

Examples of `when` conditions:
- `severity is high or critical`
- `the root cause was identified`
- `no related issues were found`

Claude evaluates these conditions against the source node's output at runtime to determine routing.

## Properties panel

The right panel shows properties for the selected element, or workflow metadata when nothing is selected.

### Workflow meta (nothing selected)

- **ID** -- the workflow identifier (read-only display)
- **Name** -- human-readable workflow name
- **Description** -- a brief description of what the workflow does
- **Entry node** -- dropdown to select which node execution starts at

### Node properties

- **ID** -- the machine identifier (editable; must be unique, alphanumeric with hyphens and underscores)
- **Name** -- human-readable node name displayed on the canvas
- **Instruction** -- what Claude should accomplish at this step. This is the exact text Claude receives, so write it as a direct instruction. Click the expand button for a full-screen editor.
- **Skills** -- toggle which skills are available at this node. Enabled skills provide their tools to Claude during execution.
- **Set as entry** -- make this node the workflow entry point
- **Delete node** -- remove the node and all connected edges

:::note[Output schemas]
Structured output schemas are supported in the workflow YAML and TypeScript API, but the visual editor does not yet have a UI for editing them. To add an output schema, export as YAML, add the `output` field manually, and re-import.
:::

:::note[Instruction tips]
Write instructions as direct commands to Claude: "Search for recent errors in Sentry and Datadog. Focus on the last 24 hours. Summarize severity, affected services, and frequency." The instruction is exactly what Claude reads at runtime.
:::

### Edge properties

- **From** -- source node (read-only display)
- **To** -- target node (changeable via dropdown)
- **Condition (when)** -- natural-language condition for conditional routing, or empty for unconditional
- **Delete edge** -- remove the edge

## Undo and redo

Studio tracks a full undo history for structural workflow changes (adding/removing/editing nodes and edges, changing the entry node). Selection changes and layout recalculations are excluded from history.

- **Undo** -- `Cmd+Z` (macOS) or `Ctrl+Z` (Windows/Linux), or click **undo** in the toolbar
- **Redo** -- `Cmd+Shift+Z` or `Ctrl+Shift+Z`, or click **redo** in the toolbar

History is powered by [zundo](https://github.com/charkour/zundo) on top of the Zustand store.

## Export formats

Click **Export** in the toolbar to choose a format:

| Format | Use case |
|--------|----------|
| **YAML** | Check into version control, use with `sweny run` CLI |
| **JSON** | Programmatic consumption, API payloads |
| **TypeScript** | Import as a typed `Workflow` constant in your codebase |
| **GitHub Actions** | Ready-to-use `.github/workflows/` file with CLI install and secrets auto-detected |

All exports produce a file download. The GitHub Actions export generates a workflow that installs the SWEny CLI and runs `sweny workflow run`. It inspects which skills the workflow uses and adds the corresponding environment variables (`GITHUB_TOKEN`, `LINEAR_API_KEY`, `SENTRY_AUTH_TOKEN`, `DD_API_KEY`, `SLACK_BOT_TOKEN`, `NOTIFICATION_WEBHOOK_URL`) to the job's env block automatically.

:::note[BetterStack in GitHub Actions export]
The GitHub Actions export does not yet auto-detect BetterStack credentials. If your workflow uses the BetterStack skill, manually add `BETTERSTACK_API_TOKEN: ${{ secrets.BETTERSTACK_API_TOKEN }}` to the env block.
:::

## Import

Click **Import** in the toolbar to open the import modal. Paste or upload a JSON or YAML `Workflow` definition. The imported workflow replaces the current one and resets undo history.

You can also drag-and-drop a `.json` or `.yaml` file directly onto the canvas.

## Validation

Studio validates the workflow graph in real time and shows errors inline:

- A node marked as `entry` that does not exist
- Edges pointing to unknown node IDs
- Unreachable nodes (no inbound edges and not the entry node)
- Unknown skill IDs

Unreachable nodes display with a dashed orange border and an orange warning badge. The properties panel shows a warning banner when an unreachable node is selected, prompting you to add an incoming edge.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Z` | Undo |
| `Cmd+Shift+Z` | Redo |
| `D` | Duplicate selected node |
| `Delete` / `Backspace` | Delete selected node or edge |
| Scroll wheel | Zoom |
| Click + drag (background) | Pan |
