# Toolbox Search, Collapsible Categories, and Polish

## Why this matters
With 18 templates across 5 categories, the toolbox is getting long. Users need to quickly find the
template they want. Collapsible categories let power users hide sections they don't need, and a search
box provides instant filtering — standard patterns in any design tool (Figma, VS Code, etc.).

## What to do

### 1. Add a search input at the top of NodeToolbox
- Sticky search input below the "Drag to canvas" header
- Filters templates by name, description, and skill IDs (case-insensitive)
- When search is active, expand all categories and highlight matches
- Clear button (x) to reset search
- Placeholder: "Search nodes..."

### 2. Make categories collapsible
- Each category header becomes a toggle button (click to expand/collapse)
- Small chevron indicator (right arrow when collapsed, down arrow when expanded)
- All categories start expanded by default
- Collapsed state is local component state (does not persist)
- When searching, override collapse state to show all matching categories

### 3. Show template count per category
- Show count badge next to category name, e.g. "CODE (4)"
- When searching, show filtered count, e.g. "CODE (2)"

### 4. Visual polish
- Category headers get a subtle hover state
- Smooth height transition on collapse/expand (use CSS `max-height` + `overflow: hidden` + `transition`)
- Empty state when search matches nothing: "No templates match your search"

## Files to modify
- `packages/studio/src/components/NodeToolbox.tsx`

## Acceptance criteria
- Search input filters templates in real-time as the user types
- Categories collapse/expand on click with smooth animation
- Count badges update correctly during search
- Empty search state is handled gracefully
- `npm run build` passes in packages/studio
