# SWEny Brand Guide

## Logo

SWEny's logo is a text-based wordmark with a color split: **SWE** in the primary text color, **ny** in brand blue.

### Variants

| Variant | File | Use on |
|---------|------|--------|
| Wordmark (light) | `assets/logo-wordmark-light.svg` | Dark backgrounds |
| Wordmark (dark) | `assets/logo-wordmark-dark.svg` | Light backgrounds |
| DAG Icon (light) | `assets/logo-icon-light.svg` | Dark backgrounds |
| DAG Icon (dark) | `assets/logo-icon-dark.svg` | Light backgrounds |
| Lockup (light) | `assets/logo-lockup-light.svg` | Dark backgrounds |
| Lockup (dark) | `assets/logo-lockup-dark.svg` | Light backgrounds |

### When to use which

- **Wordmark** — default. Navigation, marketing, docs headers.
- **DAG Icon** — small contexts. Favicon, app icon, social avatar.
- **Lockup** — full branded headers. README, documentation hero.

### Do

- Maintain clear space equal to the height of "S" around the wordmark
- Use the correct variant for the background (light logo on dark, dark logo on light)

### Don't

- Rotate, stretch, or skew
- Change the color split
- Add shadows, gradients, or effects
- Place on busy backgrounds without sufficient contrast
- Use the old sparkle favicon

---

## Colors

### Core Palette

| Role | Hex | Tailwind Class |
|------|-----|----------------|
| Brand Dark (background) | `#1e293b` | `slate-800` |
| Surface (cards, sidebar) | `#162032` | custom |
| Border | `#334155` | `slate-700` |
| Primary | `#3b82f6` | `blue-500` |
| Primary Hover | `#2563eb` | `blue-600` |
| Primary Muted | `#1e3a5f` | `blue-900` |
| Accent Light | `#60a5fa` | `blue-400` |

### Text

| Role | Hex (dark bg) | Hex (light bg) |
|------|---------------|----------------|
| Primary | `#f1f5f9` | `#0f172a` |
| Secondary | `#94a3b8` | `#64748b` |
| Muted | `#64748b` | `#94a3b8` |

### Semantic

| Role | Hex | Tailwind |
|------|-----|----------|
| Success | `#4ade80` | `green-400` |
| Warning | `#facc15` | `yellow-400` |
| Error | `#f87171` | `red-400` |
| Info | `#60a5fa` | `blue-400` |

### Light Mode

| Role | Hex | Tailwind |
|------|-----|----------|
| Background | `#f8fafc` | `slate-50` |
| Surface | `#ffffff` | `white` |
| Border | `#e2e8f0` | `slate-200` |
| Primary | `#2563eb` | `blue-600` |

---

## Typography

No custom fonts. System stack everywhere.

| Role | Stack | Weight |
|------|-------|--------|
| Logo | `system-ui, -apple-system, 'Helvetica Neue', sans-serif` | 800 |
| Headings | Same | 700-800 |
| Body | Same | 400-500 |
| Code | `'SF Mono', 'Fira Code', 'JetBrains Mono', ui-monospace, monospace` | 400-600 |

---

## Assets Inventory

### SVGs (in `assets/`)

6 files: wordmark, icon, lockup — each in light and dark variants.

### Favicon & Icons (in `packages/web/public/`)

| File | Size | Purpose |
|------|------|---------|
| `favicon.svg` | Scalable | Modern browsers (dark/light mode aware) |
| `apple-touch-icon.png` | 180x180 | iOS home screen |
| `icon-192.png` | 192x192 | PWA / Android |
| `icon-512.png` | 512x512 | PWA splash |

### Social Images (in `packages/web/public/`)

| File | Size | Purpose |
|------|------|---------|
| `og-image.png` | 1200x630 | Open Graph (link sharing) |
| `twitter-card.png` | 1200x600 | Twitter/X card |
| `github-social.png` | 1280x640 | GitHub repo social preview |

### Regenerating PNGs

```bash
node scripts/generate-brand-pngs.mjs
```

Reads SVGs from `assets/`, writes PNGs to `packages/web/public/`.
