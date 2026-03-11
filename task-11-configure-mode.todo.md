# Task 11: Configure Mode in Recipe Explorer

## Goal
Add a "Configure" view mode to RecipeExplorer that turns the explorer into a
visual workflow configurator. Users can pick which provider implements each
step, see required env vars, and export a ready-to-run .env + config snippet.

## UX Design

### Layout (Configure mode)
Three vertical sections:
1. DAG (left, 40% width) — same graph but nodes show config status badges
   - ● green dot: provider selected
   - ○ yellow dot: needs selection
   - — gray dot: no provider needed
2. Step Config (center, 35%) — scrollable list of all states with providers
   For each state that has `state.provider`:
   - State name (monospace)
   - Description
   - Provider dropdown (shows available providers for that category)
   - When selected: shows its required env vars
3. Summary (right, 25%) — live-updating config output
   - "Ready" / "X steps unconfigured" status
   - .env template (copyable)
   - runRecipe() TypeScript snippet (copyable)

### State
```typescript
type ProviderConfig = Record<string, string>; // stateId → providerId
const [providerConfig, setProviderConfig] = useState<ProviderConfig>({});
```

### Provider Dropdown Component
For a state with `state.provider = "observability"`, show:
- All entries from `PROVIDER_CATALOG.filter(p => p.category === "observability")`
- Formatted as a styled select or custom dropdown
- On select → record in providerConfig + show env vars inline

### Env Var Display (per-provider)
When a provider is selected, show its `envVars` as a list:
```
DATADOG_API_KEY=           [required] Your Datadog API key
DATADOG_APP_KEY=           [required]
DATADOG_SITE=datadoghq.com [optional] Datadog site
```
Each row: monospace key, badge (required/optional), description, secret icon for secret vars.

### .env Generation
Collect all selected providers, deduplicate env vars (GITHUB_TOKEN appears
in both source-control and issue-tracking — show once), generate:
```
# observability (Datadog)
DATADOG_API_KEY=
DATADOG_APP_KEY=
DATADOG_SITE=datadoghq.com

# issueTracking (Linear)
LINEAR_API_KEY=
LINEAR_TEAM_ID=

# ... etc
```

### runRecipe() Code Generation
Generate TypeScript snippet showing how to initialize providers:
```typescript
import { datadog } from "@sweny-ai/providers/observability";
import { linear } from "@sweny-ai/providers/issue-tracking";
// ...

const registry = createProviderRegistry();
registry.set("observability", datadog({ apiKey: process.env.DATADOG_API_KEY!, ... }));
registry.set("issueTracking", linear({ apiKey: process.env.LINEAR_API_KEY!, ... }));
// ...

const result = await runRecipe(triageRecipe, config, registry);
```

### Node Badge Update in Configure Mode
In configure mode, the DAG shows colored dots on nodes:
- Nodes without `state.provider`: no badge
- Nodes with `state.provider` but no selection: yellow ring
- Nodes with `state.provider` and selection: green ring

## Implementation Notes
- Use PROVIDER_CATALOG from @sweny-ai/providers (once task-10 is done)
- Alternatively, inline a simplified catalog in RecipeExplorer.tsx to avoid
  bundling the full providers package in the web build
- The .env and code generation is pure string building — no eval/exec

## Acceptance
- Configure mode is accessible via the view mode toggle
- All states with provider annotations show provider dropdowns
- Selecting providers updates the .env and code snippet live
- Nodes in the DAG update their visual status based on configuration
- Copy buttons work for both .env and code snippet
