---
"@sweny-ai/core": patch
---

Render a rich GitHub Actions job summary for `--notification-provider github-summary`

The markdown written to `$GITHUB_STEP_SUMMARY` now mirrors the legacy
`swenyai/sweny@v4` summary and includes:

- **Mermaid workflow diagram** colored by node execution state (success / failed / skipped),
  with taken edges highlighted in green and not-taken edges dashed. Uses `toMermaidBlock()`
  from `@sweny-ai/core` and renders natively in the GitHub Actions summary panel.
- **Config table** (repository, providers, time range, service filter, severity, duration, mode).
- **Workflow path** showing the actual execution sequence including loop iteration counts.
- **Routing decisions** (collapsible) when the DAG had conditional edges.
- **Findings table** with severity, title, fix complexity, and dedup status.
- **Actions taken** section with issue and PR links.
- **Node execution details** (collapsible) with a per-node tool-call summary.

`main.ts` now captures the execution `trace` from `execute(triageWorkflow, ...)` and passes
`{ workflow: triageWorkflow, trace }` into `formatDagResultMarkdown` so the diagram reflects
the real run.

Also fixes a long-standing bug in `mermaid.ts` where the entry-node marker was rendered as
the literal string `\u25B6` instead of the ▶ character (caused by a double-escaped sequence
in the source).
