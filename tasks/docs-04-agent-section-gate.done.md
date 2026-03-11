# docs-04: Gate the Agent Reference section behind a "self-hosting" callout

## Goal
The "Agent Reference" section in the docs sidebar contains 4 pages (`plugins.md`, `built-in-plugins.md`, `model-architecture.md`, `configuration.md`) that document the `@sweny-ai/agent` package — a self-hosted interactive Slack bot. These pages are useful, but they're not for the typical SWEny user (who just adds the GitHub Action). Add a clear callout at the top of each page that orients the reader and prevents confusion.

Also, **delete `model-architecture.md`** entirely (see below).

## Context
The GitHub Action (`swenyai/sweny@v1`) and CLI (`@sweny-ai/cli`) are the primary ways people use SWEny. The `@sweny-ai/agent` package is for teams that want to host their own persistent Slack bot powered by SWEny. The current Agent Reference pages read like internal developer docs — they expose TypeScript interfaces (`ModelRunner`, `ClaudeRunner`, `CodingAgent`), implementation details, and SDK internals that confuse ordinary users.

## Files to edit
- `packages/web/src/content/docs/agent/plugins.md`
- `packages/web/src/content/docs/agent/built-in-plugins.md`
- `packages/web/src/content/docs/agent/configuration.md`
- `packages/web/src/content/docs/agent/model-architecture.md` — **DELETE this file**
- `packages/web/astro.config.mjs` — remove `model-architecture` from sidebar

## model-architecture.md — delete it
This page documents internal TypeScript interfaces: `CodingAgent`, `CodingAgentRunOptions`, `ModelRunner`, `ModelRunOptions`, `RunResult`, `ToolCall`, `ClaudeCodeRunner`, `toSdkTool()` adapter, `ClaudeRunner` orchestrator internals, system prompt assembly, etc.

This is purely internal implementation detail. It's not useful to anyone configuring or extending SWEny — it only matters if you're hacking on the agent source code itself, in which case you'd read the source directly.

**Delete the file.** Remove the `{ label: "Model Architecture", slug: "agent/model-architecture" }` entry from the sidebar in `astro.config.mjs`.

## plugins.md, built-in-plugins.md, configuration.md — add callout
Add this callout block at the very top of each page, right after the frontmatter (before any other content):

```md
:::note[Self-hosted agent]
This page is for teams running the **`@sweny-ai/agent`** package — a self-hosted Slack bot powered by SWEny. If you're using the **GitHub Action** (`swenyai/sweny@v1`) or the **CLI** (`@sweny-ai/cli`), you can skip this section.
:::
```

Starlight supports `:::note[title]` / `:::tip` / `:::caution` admonition blocks. Use `:::note[Self-hosted agent]` as above.

## configuration.md — additional cleanup
Beyond adding the callout, also clean up `configuration.md`:

1. Remove the `## CLI mode` section (it documents `npx tsx --env-file=.env src/cli.ts` — this is for running from monorepo source, not the published `@sweny-ai/cli`)
2. Remove the `## Config resolution` section — implementation detail about how `loadConfig()` works internally, not useful to someone configuring the agent
3. Keep: frontmatter, callout (new), `## sweny.config.ts` example, `## SwenyConfig reference` table, `## Environment variables` table

## No changeset needed
`packages/web` is private. No `.changeset/` file needed.

## Acceptance criteria
- `model-architecture.md` file is deleted
- `model-architecture` entry removed from sidebar in `astro.config.mjs`
- `plugins.md`, `built-in-plugins.md`, `configuration.md` each have the self-hosted callout at top
- `configuration.md` has CLI mode and Config resolution sections removed
- `npm run build --workspace=packages/web` passes with no errors
