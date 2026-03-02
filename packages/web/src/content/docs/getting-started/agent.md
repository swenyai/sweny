---
title: Deploying the Agent
description: Run the SWEny agent as an interactive bot or CLI.
---

The `@sweny-ai/agent` package is an agentic harness that orchestrates coding sessions. The model backend and messaging channel are pluggable — deploy it as a Slack bot (more channels planned) or run it locally as an interactive CLI.

## Slack channel

The first supported channel is Slack. More channels are planned.

### Prerequisites

- A Slack app with Socket Mode enabled
- Bot token scopes: `chat:write`, `app_mentions:read`, `im:history`, `im:read`, `im:write`
- An app-level token with `connections:write` scope

### Configuration

Create a `sweny.config.ts` in your project root:

```typescript
import { defineConfig } from "@sweny-ai/agent";
import { noAuth } from "@sweny-ai/providers/auth";
import { fsStorage } from "@sweny-ai/providers/storage";
import { memoryPlugin, workspacePlugin } from "@sweny-ai/agent";

export default defineConfig({
  name: "sweny",
  auth: noAuth(),
  storage: fsStorage({ baseDir: "./.sweny-data" }),
  plugins: [memoryPlugin(), workspacePlugin()],
  model: {
    maxTurns: 25,
  },
});
```

See [Agent Configuration](/agent/configuration/) for the full config reference.

### Environment variables

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
CLAUDE_CODE_OAUTH_TOKEN=...  # or ANTHROPIC_API_KEY
```

### Run

```bash
npm run dev
```

## Interactive CLI

Run the agent as a local REPL without Slack:

```bash
npm run cli
```

The CLI uses the same config, plugins, and model runner as the bot.

## Plugins

The agent supports custom tool plugins. Each plugin can expose tools to the model and inject sections into the system prompt:

```typescript
import { z } from "zod";
import { agentTool } from "@sweny-ai/providers/agent-tool";
import type { ToolPlugin } from "@sweny-ai/agent";

export function httpPlugin(): ToolPlugin {
  return {
    name: "http",
    description: "Make HTTP requests",
    createTools() {
      return [
        agentTool(
          "http_get",
          "Fetch a URL and return its body",
          { url: z.string().url() },
          async (args) => ({
            content: [{ type: "text", text: await (await fetch(args.url as string)).text() }],
          }),
        ),
      ];
    },
  };
}
```

Add it to your config:

```typescript
export default defineConfig({
  // ...
  plugins: [memoryPlugin(), workspacePlugin(), httpPlugin()],
});
```

See [Plugin System](/agent/plugins/) for the full API reference and [Built-in Plugins](/agent/built-in-plugins/) for the tools included out of the box.

## Storage backends

The agent persists sessions, memory, and workspace files. Choose a backend:

```typescript
// Local filesystem (development)
import { fsStorage } from "@sweny-ai/providers/storage";
const storage = fsStorage({ baseDir: "./.sweny-data" });

// Amazon S3 (production)
import { s3Storage } from "@sweny-ai/providers/storage";
const storage = s3Storage({ bucket: "my-sweny-bucket", prefix: "agent" });
```
