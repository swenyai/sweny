import type { MCPServerConfig } from "../mcp/index.js";

export interface CodingAgentRunOptions {
  prompt: string;
  maxTurns: number;
  env?: Record<string, string>;
  /** Kill the agent process after this many milliseconds. No limit if omitted. */
  timeoutMs?: number;
  /**
   * MCP servers to inject into the agent during this run.
   * Written to a temp config file and passed as --mcp-config (or equivalent)
   * to the agent CLI. Supports stdio and Streamable HTTP transports.
   *
   * Example:
   * ```ts
   * mcpServers: {
   *   datadog: { type: "http", url: "https://mcp.datadoghq.com/...", headers: { DD_API_KEY: "..." } },
   *   github:  { type: "stdio", command: "/usr/local/bin/github-mcp", env: { GITHUB_TOKEN: "..." } },
   * }
   * ```
   */
  mcpServers?: Record<string, MCPServerConfig>;
}

export interface CodingAgent {
  install(): Promise<void>;
  run(opts: CodingAgentRunOptions): Promise<number>;
}

/** A real-time event emitted by a coding agent provider during run(). */
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; success: boolean; output: string }
  | { type: "thinking"; text: string }
  | { type: "error"; message: string };

/** Callback signature for receiving agent events. */
export type AgentEventHandler = (event: AgentEvent) => void | Promise<void>;
