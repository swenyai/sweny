import type { ZodRawShape } from "zod";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface AgentTool<T extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  schema: T;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}
