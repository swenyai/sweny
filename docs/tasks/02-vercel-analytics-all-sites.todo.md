# Task 02: Add Vercel Analytics & Speed Insights to docs and spec sites

## Goal
Add `@vercel/analytics` and `@vercel/speed-insights` to the two Astro sites that don't have them yet:
1. `packages/web/` (docs.sweny.ai)
2. `spec/` (spec.sweny.ai)

## Context
- cloud.sweny.ai and marketplace.sweny.ai already have both (Next.js — `@vercel/analytics/react` + `@vercel/speed-insights/next`)
- The Astro sites need the **web** variant: `@vercel/analytics` and `@vercel/speed-insights` (framework-agnostic)
- Both sites use Astro + Starlight

## How Vercel Analytics works with Astro
For static Astro sites, inject the Vercel analytics/speed-insights scripts via a Starlight head component or Astro layout.

### Option A: Use `@vercel/analytics/astro` (if available in v2+)
Check if `@vercel/analytics` exports an Astro integration. If so:
```js
// astro.config.mjs
import vercelAnalytics from '@vercel/analytics/astro';
export default defineConfig({
  integrations: [vercelAnalytics(), ...]
});
```

### Option B: Inject via Starlight `<head>` customization
Starlight supports custom head elements. Add the script tags directly:
```js
// In astro.config.mjs starlight config:
head: [
  { tag: 'script', attrs: { src: '/_vercel/insights/script.js', defer: true } },
  { tag: 'script', attrs: { src: '/_vercel/speed-insights/script.js', defer: true } },
],
```
Note: These scripts are auto-injected by Vercel's build system when Analytics/SpeedInsights are enabled in the Vercel dashboard. You may just need to enable them in the Vercel project settings.

### Option C: Astro component injection
Install packages and create a component:
```bash
npm install @vercel/analytics @vercel/speed-insights
```
Create `src/components/Analytics.astro`:
```astro
<script>
  import { inject } from '@vercel/analytics';
  import { injectSpeedInsights } from '@vercel/speed-insights';
  inject();
  injectSpeedInsights();
</script>
```
Then include in Starlight's custom override or head.

## Steps

### 1. Install packages in both sites
```bash
npm install @vercel/analytics @vercel/speed-insights --workspace=packages/web
cd spec && npm install @vercel/analytics @vercel/speed-insights
```

### 2. Add analytics component/script to docs site (`packages/web/`)
- Check Starlight's head customization in `astro.config.mjs`
- Inject analytics via whichever method works for Astro/Starlight

### 3. Add analytics component/script to spec site (`spec/`)
- Same approach as docs site

### 4. Verify
- Build both sites locally
- Confirm no build errors

## Acceptance Criteria
- [ ] `@vercel/analytics` and `@vercel/speed-insights` installed in both sites
- [ ] Analytics scripts injected in both sites' pages
- [ ] Both sites build successfully
