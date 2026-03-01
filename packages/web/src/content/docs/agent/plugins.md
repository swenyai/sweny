---
title: Plugin System
description: Build custom tool plugins to extend the SWEny agent with new capabilities.
---

The agent's capabilities are defined by plugins. Each plugin provides tools that the model can call during a conversation, plus optional system prompt sections that guide how tools are used.

## AgentTool

Tools are defined using the `AgentTool` interface from `@swenyai/providers/agent-tool`:

```typescript
import type { AgentTool, ToolResult } from "@swenyai/providers/agent-tool";
```

```typescript
interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

interface AgentTool<T extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  schema: T;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}
```

The `schema` field uses [Zod](https://zod.dev) raw shapes to define input parameters. Each tool returns a `ToolResult` with one or more text content blocks. Set `isError: true` to signal failure to the model.

### agentTool() factory

The `agentTool()` helper creates an `AgentTool` with a single function call:

```typescript
import { z } from "zod";
import { agentTool } from "@swenyai/providers/agent-tool";

const greet = agentTool(
  "greet",
  "Greet a user by name",
  { name: z.string().describe("The user's name") },
  async (args) => ({
    content: [{ type: "text", text: `Hello, ${args.name}!` }],
  }),
);
```

## ToolPlugin interface

Plugins implement the `ToolPlugin` interface:

```typescript
import type { ToolPlugin, PluginContext } from "@swenyai/agent";
```

```typescript
interface ToolPlugin {
  name: string;
  description?: string;
  createTools(ctx: PluginContext): AgentTool[] | Promise<AgentTool[]>;
  systemPromptSection?(ctx: PluginContext): string;
  destroy?(): Promise<void>;
}
```

### PluginContext

Every plugin method receives a `PluginContext` with access to the current user, storage backends, plugin-specific config, and a logger:

```typescript
interface PluginContext {
  user: UserIdentity;
  storage: {
    memory: MemoryStore;
    workspace: WorkspaceStore;
  };
  config: Record<string, unknown>;
  logger: Logger;
}
```

### Lifecycle

| Method | When called | Purpose |
|--------|------------|---------|
| `createTools(ctx)` | Every user message | Return tools available for this session |
| `systemPromptSection(ctx)` | Every user message | Inject markdown into the system prompt |
| `destroy()` | Application shutdown | Clean up resources (connections, timers) |

`createTools()` is called per-session, so tools can be tailored to the current user's identity or access level. Both `systemPromptSection()` and `destroy()` are optional.

## Writing a custom plugin

Here is a complete plugin that adds an HTTP request tool with host allowlisting:

```typescript
import { z } from "zod";
import { agentTool } from "@swenyai/providers/agent-tool";
import type { AgentTool } from "@swenyai/providers/agent-tool";
import type { ToolPlugin, PluginContext } from "@swenyai/agent";

interface HttpPluginOpts {
  allowedHosts?: string[];
}

export function httpPlugin(opts: HttpPluginOpts = {}): ToolPlugin {
  return {
    name: "http",
    description: "HTTP request tool for making outbound API calls.",

    createTools(_ctx: PluginContext): AgentTool[] {
      return [
        agentTool(
          "http_request",
          "Make an HTTP request. Returns the status code, headers, and body.",
          {
            method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
            url: z.string().url(),
            headers: z.record(z.string()).optional(),
            body: z.string().optional(),
          },
          async (args) => {
            const url = new URL(args.url as string);

            if (opts.allowedHosts?.length && !opts.allowedHosts.includes(url.hostname)) {
              return {
                content: [{ type: "text", text: `Host not allowed: ${url.hostname}` }],
                isError: true,
              };
            }

            const response = await fetch(args.url as string, {
              method: args.method as string,
              headers: args.headers as Record<string, string> | undefined,
              body: args.body as string | undefined,
            });

            const body = await response.text();
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: response.status,
                  headers: Object.fromEntries(response.headers.entries()),
                  body: body.length > 10000 ? body.slice(0, 10000) + "...(truncated)" : body,
                }, null, 2),
              }],
            };
          },
        ),
      ];
    },

    systemPromptSection(): string {
      const hosts = opts.allowedHosts?.length
        ? `Allowed hosts: ${opts.allowedHosts.join(", ")}`
        : "All hosts are allowed.";
      return `## HTTP\nYou can make outbound HTTP requests using the \`http_request\` tool. ${hosts}`;
    },
  };
}
```

Key patterns:

- **Factory function** — `httpPlugin(opts)` returns a `ToolPlugin`. This lets callers pass configuration at registration time.
- **Zod schemas** — Each parameter gets a Zod type. Use `.describe()` to document parameters for the model.
- **Error signaling** — Return `isError: true` to tell the model something went wrong without throwing.
- **System prompt injection** — The `systemPromptSection()` output is appended to the model's system prompt, providing context about the tool's constraints.

## Adding to config

Register plugins in your `sweny.config.ts`:

```typescript
import { defineConfig } from "@swenyai/agent";
import { memoryPlugin, workspacePlugin } from "@swenyai/agent";
import { httpPlugin } from "./plugins/http.js";

export default defineConfig({
  name: "my-agent",
  // ...
  plugins: [
    memoryPlugin(),
    workspacePlugin(),
    httpPlugin({ allowedHosts: ["api.example.com"] }),
  ],
});
```

Plugins are called in registration order. The `PluginRegistry` collects all tools from all plugins and passes them to the model as a flat list.
