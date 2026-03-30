---
title: Custom Workflows
description: Build your own workflows from natural language, YAML, or Studio.
---

The fastest way to build a workflow is to describe it:

```bash
sweny workflow create "your task description here"
```

SWEny generates a full DAG with nodes, conditional routing, structured output schemas, and the right skills at each step. Refine it with `sweny workflow edit`, run it with `sweny workflow run`, or hand-edit the YAML.

This page covers all three approaches: natural language generation, writing YAML by hand, and the Studio visual editor.

## Generate a workflow from natural language

```bash
sweny workflow create "investigate slow API endpoints, group by service, \
  and create optimization tickets for anything over 2s p99"
```

SWEny renders an ASCII DAG preview and prompts you to save, refine, or discard:

```
  Save to .sweny/workflows/api-perf-audit.yml? [Y/n/refine]
```

Type a refinement instruction to iterate on the design — add quality gates, notification steps, loop-back conditions, or restructure the DAG. When it looks right, press `Y`.

For non-interactive use (CI, scripting), pass `--json`:

```bash
sweny workflow create "audit dependencies for vulnerabilities" --json > audit.yml
```

## Edit workflows with natural language

Modify an existing workflow without hand-editing YAML:

```bash
sweny workflow edit my-workflow.yml "add a Slack notification after creating tickets"
```

Or start an interactive session:

```bash
sweny workflow edit my-workflow.yml
```

The updated DAG is displayed with the same save/refine/discard flow.

## Writing YAML by hand

If you prefer to write workflows manually, here's the structure.

### A minimal workflow

Start with the simplest possible workflow -- two nodes, one edge:

```yaml
id: hello
name: Hello World
description: A simple test workflow
entry: greet
nodes:
  greet:
    name: Greet
    instruction: "Say hello and gather some basic info about the repository."
    skills: [github]
  summarize:
    name: Summarize
    instruction: "Summarize what was learned in the greet step."
    skills: []
edges:
  - from: greet
    to: summarize
```

Save this as `hello.yml` and run it:

```bash
sweny workflow validate hello.yml   # check for errors
sweny workflow run hello.yml        # execute it
```

The executor starts at `greet`, gives Claude the instruction plus the `github` skill's tools, then follows the edge to `summarize`, where Claude summarizes the results.

## Adding conditional edges

Conditional edges route execution based on Claude's analysis. The `when` clause is natural language -- Claude evaluates it against the current node's result at runtime.

```yaml
id: review-and-act
name: Review and Act
description: Analyze a code change and decide how to respond
entry: analyze
nodes:
  analyze:
    name: Analyze Change
    instruction: "Read the latest PR and assess its quality. Is it a clean change or does it need fixes?"
    skills: [github]
  approve:
    name: Approve
    instruction: "Add an approving review to the PR with a brief summary of why it looks good."
    skills: [github]
  request-changes:
    name: Request Changes
    instruction: "Add a review requesting changes. Be specific about what needs to be fixed."
    skills: [github]
edges:
  - from: analyze
    to: approve
    when: "The code change is clean, well-tested, and follows project conventions"
  - from: analyze
    to: request-changes
    when: "The code change has issues that need to be addressed before merging"
```

When `analyze` finishes, the executor presents both `when` conditions to Claude along with the node's result. Claude picks the condition that matches.

:::note[Multiple conditions]
If a node has multiple outgoing conditional edges, Claude evaluates all of them and picks the best match. You can also include one unconditional edge (no `when` clause) as a default/fallback path.
:::

## Adding structured output

Structured output schemas force Claude to return data in a predictable shape. This is especially useful when downstream nodes or routing conditions need specific fields.

```yaml
id: incident-classifier
name: Incident Classifier
description: Classify an incident and route to the right team
entry: classify
nodes:
  classify:
    name: Classify Incident
    instruction: "Analyze the incident details and classify it by type and severity."
    skills: [sentry, datadog]
    output:
      type: object
      properties:
        incident_type:
          type: string
          enum: [infrastructure, application, security, data]
        severity:
          type: string
          enum: [critical, high, medium, low]
        summary:
          type: string
      required: [incident_type, severity, summary]
  escalate:
    name: Escalate
    instruction: "Create an urgent ticket and page the on-call team."
    skills: [linear, slack]
  file-ticket:
    name: File Ticket
    instruction: "Create a standard priority ticket for the appropriate team."
    skills: [linear]
edges:
  - from: classify
    to: escalate
    when: "Severity is critical or high"
  - from: classify
    to: file-ticket
    when: "Severity is medium or low"
```

The `output` field accepts any valid JSON Schema. Claude's response is validated against it before the node completes.

## Building workflows in Studio

SWEny Studio is a visual DAG editor. Build workflows by dragging nodes, connecting edges, and editing properties in a sidebar panel. Export the result as YAML:

1. Open Studio (`npm run dev:studio` or the hosted version)
2. Add nodes and connect them with edges
3. Set instructions, skills, and output schemas in the properties panel
4. Export as YAML

See the [Studio docs](/studio/) for details.

## Knowledge injection: rules, context, and templates

You can inject additional knowledge into every node without modifying the workflow definition. The executor prepends this content to each node's instruction before Claude sees it.

### Rules

Rules are engineering standards, incident protocols, or coding guidelines that Claude **must** follow. They are injected with a "You MUST follow these" framing.

**CLI config (`.sweny.yml`):**

```yaml
rules:
  - https://company.com/engineering-standards.md
  - .github/triage-rules.md
  - "Always create issues in the Backend project"
```

Rules can be URLs (fetched at runtime), local file paths, or inline text. Multiple entries are concatenated.

### Context

Context is background information — architecture docs, service documentation, deployment guides. Injected with a "Background context" framing.

```yaml
context:
  - https://docs.company.com/architecture.md
  - docs/service-overview.md
```

### Templates

Templates control how issues and PRs are formatted:

```yaml
issue-template: .github/ISSUE_TEMPLATE/bug_report.md
pr-template: .github/pull_request_template.md
```

When set, Claude uses the template as the format for new issue bodies or PR descriptions. Can be a file path or inline text.

### Injection order

The executor builds each node's instruction in this order:

1. **Rules** — prepended first with `## Rules — You MUST Follow These`
2. **Context** — prepended second with `## Background Context`
3. **Node instruction** — the base instruction from the workflow definition

If neither rules nor context is set, the legacy `additional-instructions` field is used as a fallback.

**GitHub Action inputs:** `additional-context` (newline-separated URLs/paths/text), `issue-template`, `pr-template`.

**CLI flag:** `--additional-instructions` for inline text.

## Running custom workflows

**Validate without running:**

```bash
sweny workflow validate my-workflow.yml
```

Validation checks that the entry node exists, all edges reference valid nodes, there are no self-loops, all nodes are reachable from the entry, and referenced skills exist. Exit code 0 means valid, 1 means errors.

**Run with live output:**

```bash
sweny workflow run my-workflow.yml
```

The CLI renders a live DAG visualization showing which node is running, which have completed, and how routing decisions were made.

**Dry run (validate + show structure):**

```bash
sweny workflow run my-workflow.yml --dry-run
```

**JSON output for scripting:**

```bash
sweny workflow run my-workflow.yml --json
```

## Starting from a built-in workflow

Export a built-in workflow as YAML, then modify it:

```bash
sweny workflow export triage > my-triage.yml
```

This gives you the full triage workflow as editable YAML. Add nodes, change instructions, swap skills, or adjust routing conditions. Then validate and run:

```bash
sweny workflow validate my-triage.yml
sweny workflow run my-triage.yml
```

## Available skills

Every node declares which skills (tool sets) it needs. These are the skills currently available:

| Skill ID | Category | Description |
|----------|----------|-------------|
| `github` | git | GitHub repos, PRs, issues, code search, file operations |
| `linear` | tasks | Linear issues, projects, teams |
| `sentry` | observability | Sentry errors, events, releases |
| `datadog` | observability | Datadog logs, metrics, monitors |
| `betterstack` | observability | Better Stack incidents, logs |
| `slack` | notification | Slack messages and channels |
| `notification` | notification | Discord, Teams, webhook, email |

A node can list multiple skills. The executor only loads the ones that are actually configured with credentials. If a node lists `["sentry", "datadog"]` but only Datadog credentials are set, only Datadog tools will be available.

## What's next?

- [YAML Reference](/workflows/yaml-reference/) -- full schema and validation rules for workflow files
- [How Workflows Work](/workflows/) -- deep dive into the execution model
- [Skills Overview](/skills/) -- detailed documentation for each skill
