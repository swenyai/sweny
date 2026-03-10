export interface CodingAgentRunOptions {
  prompt: string;
  maxTurns: number;
  env?: Record<string, string>;
  /** Kill the agent process after this many milliseconds. No limit if omitted. */
  timeoutMs?: number;
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
