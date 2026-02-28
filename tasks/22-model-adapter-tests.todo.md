# Task 22 — Tests for model/adapter.ts

## Objective

Add tests for the `toSdkTool()` and `toSdkTools()` functions that bridge between the SDK-agnostic `AgentTool` format and the Claude Code SDK's tool format.

## File Under Test

`packages/agent/src/model/adapter.ts` (25 lines)

```ts
import { tool } from "@anthropic-ai/claude-code";
import type { AgentTool } from "@sweny/providers/agent-tool";

type SdkTool = ReturnType<typeof tool<any>>;

export function toSdkTool(agentTool: AgentTool): SdkTool {
  return tool(agentTool.name, agentTool.description, agentTool.schema, agentTool.execute);
}

export function toSdkTools(agentTools: AgentTool[]): SdkTool[] {
  return agentTools.map(toSdkTool);
}
```

## Key Types

```ts
// AgentTool (from @sweny/providers/agent-tool)
interface AgentTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;  // Zod schema
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}
```

## Test File

`packages/agent/tests/model/adapter.test.ts`

## Test Cases

1. **`toSdkTool` passes all 4 fields to SDK `tool()`** — name, description, schema, execute
2. **`toSdkTool` returns a valid SDK tool object**
3. **`toSdkTools` converts empty array** → returns `[]`
4. **`toSdkTools` converts multiple tools** → returns array of same length
5. **`toSdkTools` preserves order**

## Mock Strategy

Mock `@anthropic-ai/claude-code` to capture what `tool()` receives:

```ts
vi.mock("@anthropic-ai/claude-code", () => ({
  tool: vi.fn((name, desc, schema, exec) => ({ name, description: desc, schema, execute: exec })),
}));
```

Then verify the mock was called with the correct args.

## Verification

1. `npm test --workspace=packages/agent` — new tests pass
2. `npm test` — all tests pass
