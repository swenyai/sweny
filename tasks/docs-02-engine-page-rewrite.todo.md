# docs-02: Rewrite "Engine & Recipes" page

## Goal
`packages/web/src/content/docs/getting-started/engine.md` currently reads like internal developer documentation. Rewrite it as a short "how it works" explainer. Remove all programmatic TypeScript API content.

## Context
The page has a lot of overlap with Quick Start and Walkthrough. It explains Learn/Act/Report (already in Concepts), lists the same providers (already in Concepts table), shows an ASCII architecture diagram, and ends with a full TypeScript `runWorkflow()` example. Typical users — the ones adding `swenyai/sweny@v1` to their GitHub workflow — will never call `runWorkflow()` or `createProviderRegistry()` directly.

The page should focus on: what the engine IS (the thing that orchestrates your workflow), what a Recipe IS (pre-wired workflow for a use case), and how to use recipes through the Action/CLI. Then link out for deeper reading.

## File to edit
`packages/web/src/content/docs/getting-started/engine.md`

## Sections to REMOVE entirely
- `## Architecture` (the ASCII diagram — confusing, not consumer-facing)
- `## Running a workflow programmatically` (the big TS code block with `runWorkflow`, `createProviderRegistry`, etc.)
- `## Provider docs` (redundant with sidebar nav)

## Sections to KEEP (but trim)
- `## Overview` — keep the intro paragraph, shorten it. Remove "The engine manages provider connections, step execution, and data flow between phases." (too internal). Lead with what matters to the user: "SWEny's engine runs your recipe automatically — you don't need to write any code."
- `## The three phases` — keep but shorten each phase description by ~30%. They overlap with Concepts.
- `## Core concepts` → rename to `## Key concepts` — keep Workflow, Step, Recipe definitions. **Remove the ProviderRegistry subsection** (it has a TS code block). Instead add one sentence: "Provider connections are configured through Action inputs or `.sweny.yml` — no code required."
- `## Triage: the first recipe` — keep, it's good. Maybe rename to `## Built-in recipes` and add a row or mention for the Implement recipe alongside Triage.

## Rewritten page structure
```
---
title: Engine & Recipes
description: How SWEny's workflow engine orchestrates Learn, Act, Report pipelines.
---

[Short intro — 2 sentences]

## The three phases
[trimmed version]

## Key concepts
[Workflow, Step, Recipe — prose only, no TS]

## Built-in recipes
[Triage + Implement summary, links to recipe docs]

## What's next
[Quick links: Quick Start, Provider Reference, Recipe Authoring]
```

## Tone guide
Write as if explaining to an engineering manager or senior developer who wants to understand the system, NOT to someone who will call the TypeScript API. Avoid terms like "ProviderRegistry", "StepResult", "WorkflowContext". Use plain language.

## No changeset needed
`packages/web` is private. No `.changeset/` file needed.

## Acceptance criteria
- Zero TypeScript code blocks on the page
- No ASCII diagrams
- Page is ≤ 50 lines of content (not counting frontmatter)
- Passes `npm run build --workspace=packages/web` with no errors
