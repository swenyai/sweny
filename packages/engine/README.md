# @swenyai/engine

Workflow engine for SWEny -- orchestrates **Learn -> Act -> Report** pipelines with pluggable providers.

## Install

```bash
npm install @swenyai/engine @swenyai/providers
```

## Quick Example

```typescript
import { runWorkflow, createProviderRegistry } from "@swenyai/engine";
import { datadog } from "@swenyai/providers/observability";
import { linear } from "@swenyai/providers/issue-tracking";
import { github } from "@swenyai/providers/source-control";
import { slackWebhook } from "@swenyai/providers/notification";
import { claudeCode } from "@swenyai/providers/coding-agent";

// 1. Register providers
const providers = createProviderRegistry();
providers.set("observability", datadog({ apiKey, appKey }));
providers.set("issueTracker", linear({ apiKey }));
providers.set("sourceControl", github({ token, owner, repo }));
providers.set("notification", slackWebhook({ webhookUrl }));
providers.set("codingAgent", claudeCode({}));

// 2. Run a recipe
import { triageWorkflow } from "@swenyai/engine/recipes/triage";

const result = await runWorkflow(triageWorkflow, triageConfig, providers);
console.log(result.status); // "completed" | "failed" | "partial"
```

## Concepts

**Workflow** -- A pipeline of steps organized into three phases: Learn, Act, Report.

**Step** -- A single unit of work (e.g., "query logs", "create issue", "send notification").

**Recipe** -- A pre-built workflow. SWEny Triage is the first recipe.

**ProviderRegistry** -- A type-safe container for pluggable service integrations.

## Built-in Recipes

| Recipe | Description |
|--------|-------------|
| **Triage** | Monitor observability logs -> investigate with AI -> create tickets -> open fix PRs -> notify |

## Creating a Custom Workflow

```typescript
import type { Workflow } from "@swenyai/engine";

const myWorkflow: Workflow<MyConfig> = {
  name: "my-workflow",
  phases: {
    learn: [
      { name: "fetch-data", phase: "learn", run: fetchData },
    ],
    act: [
      { name: "process", phase: "act", run: processData },
    ],
    report: [
      { name: "notify", phase: "report", run: sendReport },
    ],
  },
};
```

## License

[MIT](../../LICENSE)
