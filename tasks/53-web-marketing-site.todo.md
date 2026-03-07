# Task: Web Marketing Site — Landing Page and Provider Docs

## Why

`packages/web` is the open-source project's Astro-based website. It currently has only a
`content.config.ts` stub with no pages, no content, and no navigation. Anyone landing on the
repo site or docs URL sees nothing.

The site should:
- Explain what SWEny is and how it works
- List supported providers (observability, issue tracking, source control)
- Provide a quick-start guide for the GitHub Action and CLI

## NOTE: Do not auto-execute this task

This task is intentionally held for manual review. The marketing copy and site structure
should be reviewed by the team before publishing. Create the task file and scaffolding only.

---

## Scope

### Pages to create

1. **`/` (Home)** — Hero, how it works (3-step diagram), CTA to GitHub
2. **`/providers`** — Provider compatibility table (observability × issue-tracking × source-control)
3. **`/docs/quickstart`** — GitHub Action setup in 5 steps
4. **`/docs/cli`** — CLI reference (`sweny triage`, `sweny implement`, `sweny init`)

### Tech

The package uses Astro. Check `packages/web/package.json` for existing deps.
Use Tailwind CSS if it's already wired up; otherwise add it.

---

## Acceptance criteria

- `npm run build` in `packages/web` succeeds
- Home page renders without 404
- Provider table lists all 8 observability providers, 4 issue trackers, 3 source control options
- Quick start shows a working GitHub Action YAML snippet

---

## How to run

```bash
cd packages/web
npm run dev   # local preview
npm run build # production build
```
