# Hardening — historical plans

This directory archives the planning + task-tracking artifacts for SWEny
hardening passes. They are kept for context (so future maintainers can see
what was validated, what was rejected, and why) but they are not active
specifications.

For current architecture and policies, see:

- [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — authoritative architecture, MCP policy, capability contract.
- [`packages/core/src/mcp-catalog.ts`](../../packages/core/src/mcp-catalog.ts) — single source of truth for provider→MCP wiring.
- [`spec/`](../../spec/) — formal workflow spec published at spec.sweny.ai.

## Contents

- `v1-plan.md` — the plan that drove the hardening-v1 PR (19 fixes across verify, loader, marketplace, docs, MCP catalog, schema). All items shipped; the plan is preserved as the validated reasoning trail.
- `tasks/fix-*.done.md` — per-fix task descriptions written for fresh-session contributors. All marked `.done` — kept for future reference on context, file paths, and acceptance criteria for similar future work.
