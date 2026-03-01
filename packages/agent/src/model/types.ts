import type { AgentTool } from "@swenyai/providers/agent-tool";

export interface ToolCall {
  toolName: string;
  toolInput: Record<string, unknown>;
  executedAt: string;
}

export interface RunResult {
  response: string;
  sessionId: string | null;
  toolCalls: ToolCall[];
}

export interface ModelRunOptions {
  prompt: string;
  systemPrompt: string;
  tools: AgentTool[];
  maxTurns: number;
  sessionId?: string | null;
  env?: Record<string, string>;
  disallowedTools?: string[];
  cwd?: string;
  name?: string;
}

export interface ModelRunner {
  run(opts: ModelRunOptions): Promise<RunResult>;
}
