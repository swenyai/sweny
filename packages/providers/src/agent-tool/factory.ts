import type { ZodRawShape } from "zod";
import type { AgentTool, ToolResult } from "./types.js";

export function agentTool<T extends ZodRawShape>(
  name: string,
  description: string,
  schema: T,
  execute: (args: Record<string, unknown>) => Promise<ToolResult>,
): AgentTool<T> {
  return { name, description, schema, execute };
}
