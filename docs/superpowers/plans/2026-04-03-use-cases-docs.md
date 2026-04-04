# Use Cases Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Use Cases" section to docs.sweny.ai showing SWEny as a general-purpose AI workflow engine beyond DevOps.

**Architecture:** Two new markdown pages (hub + flagship deep-dive), one sidebar config edit, one landing page section addition. All content is contrived/anonymized.

**Tech Stack:** Astro/Starlight markdown, astro.config.mjs sidebar config

**Spec:** `docs/superpowers/specs/2026-04-03-use-cases-docs-design.md`

---

### Task 1: Create use-cases hub page

**Files:**
- Create: `packages/web/src/content/docs/use-cases/index.md`

- [ ] **Step 1: Create hub page with frontmatter, intro, and 5 use case sections**

Full content in spec section 3. Starlight frontmatter with title/description. Intro paragraph, then 5 sections (Vendor Security Reviews, Customer Feedback Intelligence, Competitive Monitoring, Contract Lifecycle Management, Internal Knowledge Base Curation). Each section: hook, problem, DAG shape, patterns.

- [ ] **Step 2: Verify file renders** — `npm run dev` in packages/web, check /use-cases/

### Task 2: Create data pipelines deep-dive

**Files:**
- Create: `packages/web/src/content/docs/use-cases/data-pipelines.md`

- [ ] **Step 1: Create flagship page with all sections**

Full content in spec section 2. ~1200 words. Opening hook, DAG diagram, pattern spotlights (LLM-as-Judge, Multi-Phase Expansion), before/after table, sample YAML snippet using correct schema (`nodes` as object, `when` for conditions).

- [ ] **Step 2: Verify file renders** — check /use-cases/data-pipelines/

### Task 3: Update sidebar config

**Files:**
- Modify: `packages/web/astro.config.mjs:71` (between Workflows and GitHub Action groups)

- [ ] **Step 1: Add Use Cases sidebar group**

```js
{
  label: "Use Cases",
  items: [
    { label: "Overview", slug: "use-cases" },
    { label: "Data Pipelines", slug: "use-cases/data-pipelines" },
  ],
},
```

### Task 4: Update landing page

**Files:**
- Modify: `packages/web/src/content/docs/index.mdx:101` (between Built-in workflows and Run it on a schedule)

- [ ] **Step 1: Add Beyond DevOps section**

"Beyond DevOps" heading, one-line intro, CardGrid with 3 cards (Data Pipelines, Security Reviews, See all use cases).

### Task 5: Build, commit, push

- [ ] **Step 1: Build web package** — `npm run build` in packages/web
- [ ] **Step 2: Commit** — all 4 files
- [ ] **Step 3: Push to main** — triggers auto-deploy
