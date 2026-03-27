# Task: Update Astro Sidebar Config & Scaffold New File Structure

## Goal
Rewrite the Astro sidebar config in `packages/web/astro.config.mjs` to match the new IA, create empty placeholder files for new pages, and delete dead pages.

## Context
The docs site uses Astro Starlight. The sidebar is defined inline in the config file. We're rebuilding the entire docs structure to reflect the new `@sweny-ai/core` architecture (Skills, Workflows, DAG executor).

## Steps

### 1. Update `packages/web/astro.config.mjs` sidebar to:

```js
sidebar: [
  {
    label: "Getting Started",
    items: [
      { label: "Introduction", slug: "getting-started" },
      { label: "Concepts", slug: "getting-started/concepts" },
      { label: "Quick Start", slug: "getting-started/quick-start" },
      { label: "Walkthrough", slug: "getting-started/walkthrough" },
      { label: "FAQ", slug: "getting-started/faq" },
    ],
  },
  {
    label: "Workflows",
    items: [
      { label: "How Workflows Work", slug: "workflows" },
      { label: "Triage", slug: "workflows/triage" },
      { label: "Implement", slug: "workflows/implement" },
      { label: "Custom Workflows", slug: "workflows/custom" },
      { label: "YAML Reference", slug: "workflows/yaml-reference" },
    ],
  },
  {
    label: "GitHub Action",
    items: [
      { label: "Setup", slug: "action" },
      { label: "Inputs & Outputs", slug: "action/inputs" },
      { label: "Cron & Dispatch", slug: "action/scheduling" },
      { label: "Service Map", slug: "action/service-map" },
      { label: "Examples", slug: "action/examples" },
    ],
  },
  {
    label: "CLI",
    items: [
      { label: "Quick Start", slug: "cli" },
      { label: "Commands", slug: "cli/commands" },
      { label: "Examples", slug: "cli/examples" },
    ],
  },
  {
    label: "Studio",
    items: [
      { label: "Overview", slug: "studio" },
      { label: "Editor Guide", slug: "studio/editor" },
      { label: "Embedding", slug: "studio/embedding" },
      { label: "Live Mode", slug: "studio/live" },
    ],
  },
  {
    label: "Skills",
    items: [
      { label: "Overview", slug: "skills" },
      { label: "GitHub", slug: "skills/github" },
      { label: "Linear", slug: "skills/linear" },
      { label: "Sentry", slug: "skills/sentry" },
      { label: "Datadog", slug: "skills/datadog" },
      { label: "BetterStack", slug: "skills/betterstack" },
      { label: "Slack", slug: "skills/slack" },
      { label: "Notification", slug: "skills/notification" },
    ],
  },
  {
    label: "Advanced",
    collapsed: true,
    items: [
      { label: "Architecture", slug: "advanced/architecture" },
      { label: "MCP Servers", slug: "advanced/mcp-servers" },
      { label: "Troubleshooting", slug: "advanced/troubleshooting" },
    ],
  },
],
```

### 2. Create directory structure under `packages/web/src/content/docs/`:
- `workflows/` — new directory
- `skills/` — new directory
- `advanced/` — new directory

### 3. Delete dead pages:
- `agent/` directory (3 files — agent is deleted)
- `getting-started/agent.md`
- `getting-started/engine.md`
- `getting-started/providers.md`
- `getting-started/why-sweny.md` (merged into new intro)
- `getting-started/troubleshooting.md` (moves to advanced/)
- `providers/` directory (all files — replaced by skills/)
- `recipes/` directory (content moves to workflows/)

### 4. Create empty placeholder `.md` files for every new page with just frontmatter (title + description). This ensures the Astro build doesn't break while other tasks fill in content.

## Files to modify
- `packages/web/astro.config.mjs`
- All files listed above for creation/deletion

## Acceptance criteria
- `npm run build` in packages/web doesn't crash (all sidebar slugs resolve to files)
- No references to deleted pages remain in the sidebar config
