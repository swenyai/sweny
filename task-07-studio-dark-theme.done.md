# Task 07: Fix Studio RecipeViewer Visual Rendering

## Status: DONE

## Problem
The Live Recipe Explorer at /studio/explorer/ rendered with no visual styling:
- Nodes appeared as unstyled floating text (no card/box appearance)
- Node labels concatenated with metadata ("verify-accesscritical")
- White minimap box in dark canvas
- Overall layout looked broken

## Root Cause
`StateNode.tsx` and `TransitionEdge.tsx` used Tailwind CSS classes exclusively
for all visual styling. The Starlight docs site does NOT process Tailwind, so
no classes applied — only plain HTML with no visual treatment.

## Fix
Converted all Tailwind classes to inline styles with a dark-theme color palette:

### StateNode.tsx
- Phase colors: blue (#3b82f6) for learn, amber (#f59e0b) for act, green (#10b981) for report
- Exec status rings via box-shadow (no ring-* Tailwind needed)
- Dark card background (#1e293b), light text (#e2e8f0), muted description (#94a3b8)
- Badges use rgba backgrounds with phase-matching text colors

### TransitionEdge.tsx
- Label styles converted to inline CSSProperties objects
- Dark-theme edge colors (slate palette for default, red for errors)

### StandaloneViewer.tsx
- Outer container: dark background (#0f172a), border-radius, overflow hidden
- ReactFlow: colorMode="dark", Background with dark grid color
- MiniMap: dark background, dark maskColor, phase-matched node dot colors
- Controls: dark background with subtle border

## Commit
a714adc — pushed to main, Deploy Docs triggered automatically
