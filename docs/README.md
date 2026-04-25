# `docs/` is intentionally minimal

The canonical documentation lives at:

- **[spec.sweny.ai](https://spec.sweny.ai)** — formal workflow specification (nodes, edges, eval, requires, retry, sources, skills).
- **[docs.sweny.ai](https://docs.sweny.ai)** — narrative guides, getting-started flows, CLI / Action reference.

If you're looking for one of the older root-level docs (`mcp-servers.md`, `provider-authoring.md`, `recipe-authoring.md`, `self-hosted-worker.md`, `studio.md`, `recipes/`), use the canonical home instead:

| Old path | New home |
|---|---|
| `docs/architecture.md` | [docs.sweny.ai/advanced/architecture](https://docs.sweny.ai/advanced/architecture/) |
| `docs/mcp-servers.md` | [docs.sweny.ai/advanced/mcp-servers](https://docs.sweny.ai/advanced/mcp-servers/) |
| `docs/provider-authoring.md` | [docs.sweny.ai/skills](https://docs.sweny.ai/skills/) and [docs.sweny.ai/skills/custom](https://docs.sweny.ai/skills/custom/) |
| `docs/recipe-authoring.md` | [docs.sweny.ai/workflows](https://docs.sweny.ai/workflows/) and [docs.sweny.ai/workflows/custom](https://docs.sweny.ai/workflows/custom/) |
| `docs/recipes/*` | [docs.sweny.ai/action/examples](https://docs.sweny.ai/action/examples/) |
| `docs/self-hosted-worker.md` | (the aws-cloud managed-execution architecture is not the current cloud product; see [`ARCHITECTURE.md`](../ARCHITECTURE.md) for what cloud.sweny.ai actually is) |
| `docs/studio.md` | [docs.sweny.ai/studio](https://docs.sweny.ai/studio/) |

What does live in this directory:

- [`brand-guide.md`](brand-guide.md) — internal brand reference.
- [`hardening/`](hardening/) — internal planning + review notes, not user-facing.

For the high-level architecture overview targeted at contributors, see [`ARCHITECTURE.md`](../ARCHITECTURE.md) at the repo root.
