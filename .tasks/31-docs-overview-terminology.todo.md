# Task 31 — Docs: fix "Recipe" terminology in overview pages + action version

## Goal

Three overview pages still use "Recipe" where they should say "Workflow", and
the homepage quick-install snippet references `swenyai/sweny@v0.2` (very old).
Fix the version and clean up the terminology.

## Files to update

### 1. `packages/web/src/content/docs/index.mdx`

**Critical fix — wrong action version:**
- Line 72: `swenyai/sweny@v0.2` → `swenyai/sweny@v3`

**Terminology fixes:**
- Frontmatter description: no change needed (already says "workflows")
- Line 6 (hero tagline): "Triage is the first recipe" → "Triage is the first built-in workflow"
- Line 28: "Triage is the first recipe built on this engine" → "Triage is the first built-in workflow"
- Line 28: "See [Engine & Recipes](/getting-started/engine/)" → "See [Engine & Workflows](/getting-started/engine/)"
- Line 28: "how to build your own recipes" → "how to build your own workflows"

### 2. `packages/web/src/content/docs/getting-started/engine.md`

**Frontmatter:**
- title: "Engine & Recipes" → "Engine & Workflows"
- description: update to use "workflow" terminology

**Line 6:** "your recipe automatically" → "your workflow automatically"

**Line 37 (Key concepts section):**
```
**Recipe** — A pre-configured workflow for a specific use case. Recipes bundle
the right steps together and define how they connect. You pick a recipe and
configure it — no step wiring needed.
```
Replace with:
```
**Workflow** — A DAG of steps organized into the three phases. Workflows are
defined in YAML or TypeScript, executed by the engine, and can be visualized
in Studio. Built-in workflows (triage, implement) are ready to use out of the
box — or build your own.
```

**Line 39:** "steps that need them" — this is fine, no change

**Line 43:** "## Built-in recipes" → "## Built-in workflows"

**Line 67:** link text "Recipe Authoring" → "Workflow Authoring"; URL stays the same `/studio/recipe-authoring/`

### 3. `packages/web/src/content/docs/getting-started/concepts.md`

The `## Recipe` section (lines 26-30) is the old name for Workflow. Remove it —
users don't need to know that "Recipe" was the old term. The concepts are now just
Workflow and Step.

**Remove these lines:**
```markdown
## Recipe

A **Recipe** is a pre-built workflow with sensible defaults for a specific use case. Instead of wiring together steps manually, you pick a recipe and configure it.

**[SWEny Triage](/recipes/triage/)** is the first recipe — it automates the on-call triage loop by monitoring production logs, investigating the highest-impact issue, and opening a fix PR.
```

**After removing, add a link at the end of the `## Workflow` section** that points to Triage:
```
**[SWEny Triage](/recipes/triage/)** is the built-in triage workflow — monitors production logs, investigates the highest-impact issue, and opens a fix PR.
```

So the Workflow section becomes:
```markdown
## Workflow

A **Workflow** is an ordered sequence of steps organized into the three phases. The engine executes steps in order, passing context and results between them. If a step fails, the engine can skip downstream steps or the entire phase.

**[SWEny Triage](/recipes/triage/)** is the built-in triage workflow — monitors production logs, investigates the highest-impact issue, and opens a fix PR.
```

## Done when

- [ ] `index.mdx` uses `swenyai/sweny@v3` in the quick-install snippet
- [ ] `index.mdx` says "workflow" not "recipe" in tagline and body
- [ ] `engine.md` title is "Engine & Workflows"
- [ ] `engine.md` has no "Recipe" concept section — replaced with "Workflow"
- [ ] `concepts.md` has no standalone `## Recipe` section
- [ ] All three files: no references to "recipe" in user-facing descriptive text (code/path values like `/recipes/triage/` are fine to leave)
- [ ] No changeset needed (packages/web is private)
