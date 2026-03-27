// ─── Skill System ────────────────────────────────────────────────
//
// A Skill is a logical group of tools that share configuration.
// Skills replace "providers" — instead of typed interfaces that
// step code calls, skills expose tools that Claude calls directly.

export type JSONSchema = Record<string, unknown>;

/** Context passed to tool handlers at execution time */
export interface ToolContext {
  /** Resolved config values (env vars + explicit overrides) */
  config: Record<string, string>;
  /** Structured logger */
  logger: Logger;
}

/** A single tool Claude can invoke */
export interface Tool {
  name: string;
  description: string;
  input_schema: JSONSchema;
  handler: (input: any, ctx: ToolContext) => Promise<unknown>;
}

/** Config field declaration — skills say what they need */
export interface ConfigField {
  description: string;
  required?: boolean;
  /** Default environment variable to read from */
  env?: string;
}

/** Skill categories — used for validation and grouping */
export type SkillCategory = "git" | "observability" | "tasks" | "notification" | "general";

/** A skill groups related tools with shared config requirements */
export interface Skill {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  config: Record<string, ConfigField>;
  tools: Tool[];
}

// ─── DAG Workflow ────────────────────────────────────────────────
//
// A Workflow is a directed acyclic graph of nodes connected by edges.
// Each node has an instruction (what Claude should do) and a set of
// available skills. Edges define flow; conditional edges have a
// natural-language `when` clause that Claude evaluates at runtime.

/** A node in the workflow DAG */
export interface Node {
  /** Human-readable name */
  name: string;
  /** What Claude should accomplish at this step */
  instruction: string;
  /** Skill IDs available at this node */
  skills: string[];
  /** Optional structured output schema */
  output?: JSONSchema;
}

/** An edge connecting two nodes */
export interface Edge {
  from: string;
  to: string;
  /** Natural language condition — Claude evaluates at runtime */
  when?: string;
}

/** A complete workflow definition — pure data, fully serializable */
export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: Record<string, Node>;
  edges: Edge[];
  entry: string;
}

// ─── Execution ───────────────────────────────────────────────────

export interface NodeResult {
  status: "success" | "skipped" | "failed";
  /** Arbitrary data produced by this node */
  data: Record<string, unknown>;
  /** Tool calls made during this node's execution */
  toolCalls: ToolCall[];
}

export interface ToolCall {
  tool: string;
  input: unknown;
  output?: unknown;
}

export type ExecutionEvent =
  | { type: "workflow:start"; workflow: string }
  | { type: "node:enter"; node: string; instruction: string }
  | { type: "tool:call"; node: string; tool: string; input: unknown }
  | { type: "tool:result"; node: string; tool: string; output: unknown }
  | { type: "node:exit"; node: string; result: NodeResult }
  | { type: "node:progress"; node: string; message: string }
  | { type: "route"; from: string; to: string; reason: string }
  | { type: "workflow:end"; results: Record<string, NodeResult> };

export type Observer = (event: ExecutionEvent) => void;

// ─── Claude Interface ────────────────────────────────────────────
//
// Abstract interface so the executor doesn't depend on the SDK.
// Swap in a mock for testing, or a different model provider entirely.

export interface Claude {
  /** Run a node: give Claude an instruction, context, and tools */
  run(opts: {
    instruction: string;
    context: Record<string, unknown>;
    tools: Tool[];
    outputSchema?: JSONSchema;
    /** Called with status messages while Claude is working (tool name, etc.) */
    onProgress?: (message: string) => void;
  }): Promise<NodeResult>;

  /** Evaluate a routing condition — pick one of N choices */
  evaluate(opts: {
    question: string;
    context: Record<string, unknown>;
    choices: { id: string; description: string }[];
  }): Promise<string>;
}

// ─── MCP Auto-injection ──────────────────────────────────────────

export interface McpServerConfig {
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export interface McpAutoConfig {
  sourceControlProvider?: string;
  issueTrackerProvider?: string;
  observabilityProvider?: string;
  credentials: Record<string, string>;
  workspaceTools?: string[];
  userMcpServers?: Record<string, McpServerConfig>;
}

// ─── Utilities ───────────────────────────────────────────────────

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  info: (msg, data) => console.log(`[info] ${msg}`, data ?? ""),
  warn: (msg, data) => console.warn(`[warn] ${msg}`, data ?? ""),
  error: (msg, data) => console.error(`[error] ${msg}`, data ?? ""),
  debug: (msg, data) => console.debug(`[debug] ${msg}`, data ?? ""),
};
