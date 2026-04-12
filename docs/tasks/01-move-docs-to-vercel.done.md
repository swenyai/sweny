# Task 01: Move docs.sweny.ai from GitHub Pages to Vercel

## Goal
Migrate the Astro/Starlight docs site (`packages/web`) from GitHub Pages to Vercel deployment, matching the same Vercel org as the other sites.

## Context
- All other SWEny sites are on Vercel (spec.sweny.ai, cloud.sweny.ai, marketplace.sweny.ai)
- The docs site is the only one still on GitHub Pages
- Vercel org ID: `team_q73iqEacPA0Mtx3VrYkvZyo0` (see other `.vercel/project.json` files)
- The user is on Vercel Pro plan
- Domain: `docs.sweny.ai`

## Current Setup
- Framework: Astro + Starlight at `packages/web/`
- Deploy workflow: `.github/workflows/deploy-web.yml` (GitHub Pages)
- CNAME file: `packages/web/public/CNAME` → `docs.sweny.ai`
- Astro config: `packages/web/astro.config.mjs` — site is `https://docs.sweny.ai`
- Build requires: `npm run build:lib --workspace=packages/studio` before `npm run build --workspace=packages/web`

## Steps

### 1. Update Astro config for Vercel
- Remove the `GITHUB_PAGES` conditional base path logic if any exists in `astro.config.mjs`
- Add `@astrojs/vercel` adapter (or keep static output — Vercel handles static Astro fine without an adapter)
- Verify `site: "https://docs.sweny.ai"` stays

### 2. Add Vercel project config
- Create `packages/web/.vercel/project.json` — you'll need the project ID from `vercel link` or create manually
- The project should be linked to the `swenyai` Vercel team

### 3. Create `vercel.json` in `packages/web/`
```json
{
  "buildCommand": "cd ../.. && npm run build:lib --workspace=packages/studio && npm run build --workspace=packages/web",
  "outputDirectory": "dist",
  "framework": "astro"
}
```
Note: Vercel needs to build studio lib first (types dependency). The `buildCommand` handles this.

### 4. Remove GitHub Pages deployment
- Delete `.github/workflows/deploy-web.yml`
- Delete `packages/web/public/CNAME` (Vercel manages domains differently)

### 5. Verify
- Run `cd packages/web && npm run build` locally to confirm it still builds
- Confirm no references to `GITHUB_PAGES` env var remain in the codebase

## Acceptance Criteria
- [ ] `packages/web/` configured for Vercel deployment
- [ ] GitHub Pages workflow removed
- [ ] CNAME file removed (Vercel manages domain via dashboard)
- [ ] Local build still succeeds
- [ ] `vercel.json` handles the studio build dependency
