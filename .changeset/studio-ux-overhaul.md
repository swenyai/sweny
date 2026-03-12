---
"@sweny-ai/studio": minor
---

Major UX overhaul for the RecipeViewer and node components:

- **StateNode**: Fully redesigned cards — provider category icons (◉ ◈ ⎇ ⬡ ◎), semantic exec-status borders/glows, upgraded typography, more generous sizing (252–278px wide, 10px radius)
- **TransitionEdge**: Semantic edge coloring by outcome type — indigo for action outcomes, cyan for `local`/`dispatched`, amber for `duplicate`, red dashed for `failed`, muted slate for default `→`
- **AutoFitView**: Added `minZoom: 0.65` to prevent unreadable zoom levels on tall vertical DAGs
- **ELK layout**: Increased node dimensions (264×130) and spacing for better readability
- **Canvas**: Deeper dark background, refined dot grid, polished MiniMap and Controls styling
- **Pulse animation**: CSS keyframe injected for `current` execution state
