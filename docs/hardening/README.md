# Hardening: planning + task-tracking artifacts

This directory holds the planning + task-tracking artifacts for SWEny
hardening passes, both closed (preserved as the validated reasoning trail)
and active (proposals not yet implemented).

For current architecture and policies, see:

- [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — authoritative architecture, MCP policy, capability contract.
- [`packages/core/src/mcp-catalog.ts`](../../packages/core/src/mcp-catalog.ts) — single source of truth for provider→MCP wiring.
- [`spec/`](../../spec/) — formal workflow spec published at spec.sweny.ai.

## Contents

### Active

- [`contract-tests.md`](./contract-tests.md): proposal for a second hardening pass focused on silent drift between sources of the same fact (spec schema vs runtime, CLI vs loader, etc.). Surface-by-surface treatments, ranked.

### Closed

- `v1-plan.md`: the plan that drove the hardening-v1 PR (19 fixes across verify, loader, marketplace, docs, MCP catalog, schema). All items shipped; preserved as the validated reasoning trail.
- `tasks/fix-*.done.md`: per-fix task descriptions written for fresh-session contributors. All marked `.done`; kept for future reference on context, file paths, and acceptance criteria for similar future work.
