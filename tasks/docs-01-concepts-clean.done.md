# docs-01: Clean up Concepts page

## Goal
Make `packages/web/src/content/docs/getting-started/concepts.md` consumer-friendly by removing TypeScript API internals and keeping it pure, readable prose.

## Context
The Concepts page is the second thing a new user reads after Quick Start. It currently ends with a TypeScript code snippet showing `createProviderRegistry()` with raw import paths. This is confusing for the typical user who just wants to use the GitHub Action — they'll never write this code. The rest of the page (Learn/Act/Report explanation, Workflow/Step/Recipe/ProviderRegistry definitions) is good and should stay, just cleaned up.

## File to edit
`packages/web/src/content/docs/getting-started/concepts.md`

## What to change

### Remove the TypeScript code block
Delete the entire ```typescript block that shows:
```typescript
import { createProviderRegistry } from "@sweny-ai/engine";
import { datadog } from "@sweny-ai/providers/observability";
...
providers.set("observability", datadog({ apiKey, appKey }));
```
Replace it with a 1–2 sentence prose explanation instead. Something like: "You configure which providers SWEny uses through the GitHub Action inputs or CLI config — no code required. Under the hood, the engine uses a typed ProviderRegistry to wire them together, but this is handled automatically."

### Update the ProviderRegistry section
The `## ProviderRegistry` section explains the concept well but leads straight into the TS snippet. After removing the snippet, the section should end with a link: "See [Provider Reference](/providers/observability/) for the full list of supported providers and configuration options."

### Update the provider roles table
The table is good but the header "Provider Role" is jargon. Rename column to "Category". Also rename "Implementations" to "Supported services".

### Final link at bottom
The page ends with: "See [Provider Architecture](/getting-started/providers/) for details on the plugin system, and [Engine & Recipes](/getting-started/engine/) for programmatic usage."

Change this to: "See [Provider Reference](/providers/observability/) to configure your observability, issue tracking, and notification providers."
(The "programmatic usage" link is confusing for typical users.)

## What NOT to change
- The Learn/Act/Report phase explanation — it's clear and good
- The Workflow, Step, Recipe definitions — useful context
- The provider roles table (except header rename above)
- The general tone — keep it concise

## No changeset needed
`packages/web` is private and not published to npm. No changeset file required.

## Acceptance criteria
- No TypeScript code blocks remain on the page
- Page reads as pure prose + one table
- All links work (test with `npm run build --workspace=packages/web` — should produce no broken link warnings)
