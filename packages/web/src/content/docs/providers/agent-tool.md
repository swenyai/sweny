---
title: Agent Tool
description: Define typed tools that coding agents can invoke.
---

```typescript
import { agentTool } from "@swenyai/providers/agent-tool";
```

## Interface

```typescript
interface AgentTool<T extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  schema: T;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}
```

## Factory

Creates a typed tool with a Zod schema for argument validation:

```typescript
import { z } from "zod";

const greetTool = agentTool(
  "greet",
  "Greet a user by name",
  { name: z.string() },
  async (args) => ({
    content: [{ type: "text", text: `Hello, ${args.name}!` }],
  }),
);
```

The `agentTool` factory accepts four arguments:

| Argument      | Type                                              | Description                        |
| ------------- | ------------------------------------------------- | ---------------------------------- |
| `name`        | `string`                                          | Unique tool name                   |
| `description` | `string`                                          | Human-readable description         |
| `schema`      | `ZodRawShape`                                     | Zod schema defining accepted args  |
| `execute`     | `(args: Record<string, unknown>) => Promise<ToolResult>` | Function that runs the tool |

Return a `ToolResult` with `isError: true` to signal a failure without throwing.
