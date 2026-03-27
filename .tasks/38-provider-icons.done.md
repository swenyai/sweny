# Add Provider/Skill Icons to Studio

## Why this matters
The studio currently uses plain colored dots and text labels for skills (github, sentry, datadog, etc.).
Real product UIs use recognizable brand icons — this makes the tool look professional, helps users
instantly identify integrations, and makes the toolbox and node badges scannable at a glance.

## What to do

### 1. Create an icon registry component
Create `packages/studio/src/components/SkillIcon.tsx` that maps skill IDs to inline SVG icons.

Skills that need icons (use simple, recognizable SVG paths — 16x16 viewBox):
- **github** — GitHub octocat mark
- **linear** — Linear logo (stylized L / forward-slash marks)
- **sentry** — Sentry logo (the angular S shape)
- **datadog** — Datadog logo (dog silhouette simplified)
- **betterstack** — BetterStack logo (stacked bars / uptime mark)
- **slack** — Slack hash mark
- **notification** — Bell icon (generic, for webhook/email/discord/teams)

Component API:
```tsx
interface SkillIconProps {
  skillId: string;
  size?: number;    // default 14
  className?: string;
}
export function SkillIcon({ skillId, size = 14, className }: SkillIconProps)
```

If a skill ID has no icon, fall back to a colored circle (current behavior).

### 2. Update StateNode.tsx skill badges
Replace the text-only skill badges with `<SkillIcon>` + skill name side by side.
The badge should show the icon at 12px, then the skill name text.

### 3. Update NodeToolbox.tsx skill badges
Same pattern — replace text-only badges with icon + text in the toolbox template cards.

### 4. Update PropertiesPanel.tsx skill checklist
Add `<SkillIcon>` before each skill name in the checkbox list.

## Files to modify
- `packages/studio/src/components/SkillIcon.tsx` (new)
- `packages/studio/src/components/StateNode.tsx`
- `packages/studio/src/components/NodeToolbox.tsx`
- `packages/studio/src/components/PropertiesPanel.tsx`

## Acceptance criteria
- Each of the 7 built-in skills renders a recognizable SVG icon
- Icons appear in: node badges on canvas, toolbox cards, properties panel checklist
- Unknown skill IDs fall back gracefully to a colored dot
- `npm run build` passes in packages/studio
