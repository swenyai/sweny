# Task 08: Vertical Layout + Richer Node Cards

## Goal
Change the DAG flow from horizontal (LEFT→RIGHT) to vertical (TOP→DOWN), and
redesign node cards to be meaningful at-a-glance without clicking.

## Changes

### packages/studio/src/layout/elk.ts
- Change `"elk.direction": "RIGHT"` → `"elk.direction": "DOWN"`
- Change `"elk.spacing.nodeNode": "60"` → `"elk.spacing.nodeNode": "48"`
- Change `"elk.layered.spacing.edgeNodeBetweenLayers": "40"` → `"elk.layered.spacing.edgeNodeBetweenLayers": "48"`
- Change NODE_WIDTH to 220, NODE_HEIGHT to 110 (taller to fit richer content)

### packages/studio/src/components/StateNode.tsx
Replace the current flat card design with a richer card:
- 4px left accent bar colored by phase (blue/amber/green)
- State ID in monospace font, bold, top
- Phase badge moves to top-right corner (small pill)
- Description: up to 3 lines, not truncated
- Bottom row: provider role badge (if `state.provider` field exists) + critical badge
- Exec status affects background + box-shadow ring
- Node width: 220px min, height: auto (content-driven)

StateDefinition now has an optional `provider?: string` field (added in task-09).
Show it as a small badge: e.g. `◈ observability` if present, nothing if absent.

### Rebuild
Run `npm run build:lib --workspace=packages/studio`

## Acceptance
- DAG flows top to bottom
- Nodes are taller, show description, phase badge top-right, provider badge at bottom
- No horizontal scrolling on the Triage recipe (9 nodes)
