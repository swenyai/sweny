# Create Implement Workflow Page + Sidebar Restructure

## Why this matters
`/recipes/triage.md` gives triage a full overview page. The `implement` workflow has no equivalent
— users discover it buried in action/inputs.md and cli/index.md. This kills discoverability for a
key feature. The sidebar also labels the whole section "Triage Workflow" which implies everything
there (inputs, outputs, examples) only applies to Triage.

## What to do

### 1. Create `packages/web/src/content/docs/recipes/implement.md`
Model it after `recipes/triage.md`. Content:
- Frontmatter: title "SWEny Implement", description "Implement fixes for known issues without log scanning"
- What it does (brief)
- How it works — Learn/Act/Report phases:
  - Learn: fetches the issue from your tracker by identifier
  - Act: investigates the codebase, implements a fix, opens a PR
  - Report: posts result to notification channel
- When to use (vs Triage): use Implement when you already have an issue and want a fix PR fast;
  use Triage for automated scheduled scanning
- Configuration (link to action/inputs, cli/inputs)
- GitHub Action example (workflow: implement + linear-issue)
- CLI example (sweny implement ENG-123)
- Get started link to getting-started/index

### 2. Restructure `packages/web/astro.config.mjs` sidebar
Change "Triage Workflow" → "Workflows" and add both pages:

```
{
  label: "Workflows",
  items: [
    { label: "Triage", slug: "recipes/triage" },
    { label: "Implement", slug: "recipes/implement" },
  ],
},
{
  label: "GitHub Action",
  items: [
    { label: "Inputs", slug: "action/inputs" },
    { label: "Outputs", slug: "action/outputs" },
    { label: "Examples", slug: "action/examples" },
    { label: "Service Map", slug: "action/service-map" },
  ],
},
```

Also fix Studio sidebar order — Overview should come first:
```
{ label: "Overview", slug: "studio" },
{ label: "Workflow Authoring", slug: "studio/recipe-authoring" },
{ label: "Live Explorer", slug: "studio/explorer" },
```

## Related files
- `packages/web/src/content/docs/recipes/triage.md` — model this
- `packages/web/astro.config.mjs` — update sidebar
- `packages/web/src/content/docs/action/inputs.md` — already documents workflow: implement
- `packages/web/src/content/docs/cli/index.md` — already has sweny implement section
