# Task 05 — Spec prose, docs site, changeset

**Feature:** Multi-model cost tiering (issue #207). Depends on Tasks 01-04.
**This task:** Keep the normative spec and the docs site true to the implementation, and add the release changeset.

## Why
The `model` field is a spec change with conformance language, not just a docs note. The spec at `spec/` (spec.sweny.ai) is normative (MUST/SHOULD). The docs site at `packages/web` (docs.sweny.ai) carries the operator how-to. Both must reflect the new field + gateway path.

## Background you need
- Adding an optional field is a non-breaking additive change under the spec's semver (`spec/src/content/docs/index.mdx`), so no major version bump; v1.0.0 stays.
- The docs gateway example invites tool-use/JSON-mode bug reports for non-Anthropic models, so the page MUST carry an explicit "unsupported through a gateway" banner.
- Sidebar registration in `packages/web/astro.config.mjs` is easy to forget; a new page that is not registered will not appear.

## Files
- `spec/src/content/docs/nodes.mdx` — `model` row in the Node Fields table; a new normative "Model Selection" section (MUST/SHOULD), parallel to "Max Turns Semantics".
- `spec/src/content/docs/workflow.mdx` — `model` row in the Workflow Fields table.
- `spec/src/content/docs/execution.mdx` — note model resolution in step 6 ("Invoke the AI model").
- `packages/web/src/content/docs/advanced/model-gateway.md` (new) — gateway how-to: env vars (`ANTHROPIC_BASE_URL`, api-key vs auth-token, `SWENY_AUTH` + the billing asymmetry), the unsupported banner, action usage, a worked cost-tiering example, `sweny check` gateway output, and the prompt-cache caveat.
- `packages/web/astro.config.mjs` — register the new page under the "Advanced" sidebar group.
- `.changeset/multi-model-cost-tiering.md` — `@sweny-ai/core: minor` with a meaningful description.

## Acceptance
- `npm run build --workspace=packages/web` and the spec build both succeed; the gateway page renders and appears in the sidebar.
- No em-dashes in authored prose (project voice rule).

## Verification
```
npm run build --workspace=packages/core
npm run build:lib --workspace=packages/studio
npm run build --workspace=packages/web
cd spec && npm run build
```
