/**
 * Test Helpers
 *
 * MockHarness for running workflows without an API key.
 * File-based skill for local testing.
 *
 * @example
 * ```ts
 * import { MockHarness } from '@sweny-ai/core/testing'
 *
 * const harness = new MockHarness({
 *   strict: true,
 *   responses: {
 *     gather: { data: { logs: [] } },
 *     investigate: { data: { root_cause: 'NPE in handler', severity: 'high' } },
 *   },
 * })
 * ```
 */

import type { Claude, NodeResult, ToolCall, Tool, ToolContext, JSONSchema, Workflow } from "./types.js";
import { consoleLogger } from "./types.js";
import type { AgentHarness, HarnessCapabilities, HarnessRunResult } from "./harness/types.js";

// ─── Mock harness ────────────────────────────────────────────────

const MOCK_CAPABILITIES: HarnessCapabilities = {
  structuredOutput: "prompt",
  toolTrace: "skill-only",
  builtinDeny: "none",
  mcp: { inject: false, exclusive: "none" },
  sandbox: { fs: false, network: false },
  readOnly: "none",
  turnLimit: "none",
  usage: { tokens: false, costUsd: false, live: false },
  cancel: "signal",
  resume: false,
};

export interface MockNodeResponse {
  /** Tool calls to execute (optional — handlers will be called) */
  toolCalls?: { tool: string; input: Record<string, unknown> }[];
  /** Data to return as the node result */
  data?: Record<string, unknown>;
  /** Status (default: "success") */
  status?: "success" | "skipped" | "failed";
}

export interface MockHarnessOptions {
  /** Refuse incomplete or ambiguous fixtures. Does not isolate supplied tool handlers. */
  strict?: boolean;
  /** Node ID → scripted response */
  responses: Record<string, MockNodeResponse>;
  /** Route decisions: "fromNode" → chosen target node ID */
  routes?: Record<string, string>;
  /** Enables instruction matching for manual calls without nodeId; execute() supplies node IDs. */
  workflow?: Workflow;
  /** Scripted handler for `ask()` calls. */
  ask?: (instruction: string, context: Record<string, unknown>) => string;
}

/**
 * A mock Claude client that follows a script.
 *
 * For each node, it executes scripted tool calls and returns
 * scripted results. For routing decisions, it follows the
 * routes map. With no scripted route (or an invalid one) it returns
 * `null`, mirroring the real client failing closed on a route-eval failure.
 */
export class MockHarness implements Claude, AgentHarness {
  readonly id = "mock" as const;
  readonly capabilities = MOCK_CAPABILITIES;
  private callOrder: string[] = [];
  private responses: Record<string, MockNodeResponse>;
  private routes: Record<string, string>;
  private instructionMap: Map<string, string[]>; // instruction text → matching node IDs
  private strict: boolean;
  private askFn?: (i: string, c: Record<string, unknown>) => string;

  constructor(opts: MockHarnessOptions) {
    this.strict = opts.strict ?? false;
    this.responses = opts.responses;
    this.routes = opts.routes ?? {};
    this.askFn = opts.ask;
    // Build reverse map: instruction → node ID (for accurate matching in branching workflows)
    this.instructionMap = new Map();
    if (opts.workflow) {
      for (const [id, node] of Object.entries(opts.workflow.nodes)) {
        // Source can be a string or an object — only index string instructions
        if (typeof node.instruction === "string") {
          const ids = this.instructionMap.get(node.instruction) ?? [];
          ids.push(id);
          this.instructionMap.set(node.instruction, ids);
        }
      }
    }
  }

  /** Returns the order in which nodes were executed */
  get executedNodes(): string[] {
    return [...this.callOrder];
  }

  async preflight(): Promise<{ ok: true; version: string }> {
    return { ok: true, version: "mock" };
  }

  /** One scripted completion: the `ask` script, or the empty string. */
  async complete(req: { prompt: string }): Promise<string | null> {
    return this.ask({ instruction: req.prompt, context: {} });
  }

  async run(opts: {
    nodeId?: string;
    instruction: string;
    context: Record<string, unknown>;
    tools: Tool[];
    outputSchema?: JSONSchema;
  }): Promise<HarnessRunResult> {
    const result = await this.runScripted(opts);
    return { ...result, harness: { id: "mock", version: "mock" }, degraded: [] };
  }

  private async runScripted(opts: {
    nodeId?: string;
    instruction: string;
    context: Record<string, unknown>;
    tools: Tool[];
    outputSchema?: JSONSchema;
  }): Promise<NodeResult> {
    // Executor identity is authoritative. Text matching is for older manual callers.
    const nodeId = opts.nodeId ?? this.identifyNode(opts.instruction);
    if (nodeId === null) {
      return this.fixtureFailure(
        "ambiguous or unknown instruction; pass nodeId or provide a workflow with unique instructions",
      );
    }
    this.callOrder.push(nodeId);

    const response = Object.hasOwn(this.responses, nodeId) ? this.responses[nodeId] : undefined;
    if (!response) {
      if (this.strict) return this.fixtureFailure(`node "${nodeId}" has no scripted response`);
      return {
        status: "success",
        data: { summary: `Mock: no scripted response for "${nodeId}"` },
        toolCalls: [],
      };
    }

    // Check the entire script before executing any handler, so an incomplete
    // fixture cannot perform an earlier write before discovering a missing tool.
    if (this.strict) {
      const missing = response.toolCalls?.find((tc) => !opts.tools.some((tool) => tool.name === tc.tool));
      if (missing) return this.fixtureFailure(`node "${nodeId}" requests unavailable tool "${missing.tool}"`);
    }

    // Execute scripted tool calls
    const toolCalls: ToolCall[] = [];
    if (response.toolCalls) {
      for (const tc of response.toolCalls) {
        const tool = opts.tools.find((t) => t.name === tc.tool);
        if (tool) {
          const defaultCtx: ToolContext = { config: {}, logger: consoleLogger };
          const output = await tool.handler(tc.input, defaultCtx);
          toolCalls.push({ tool: tc.tool, input: tc.input, output });
        } else {
          toolCalls.push({ tool: tc.tool, input: tc.input, output: { error: "tool not found" } });
        }
      }
    }

    return {
      status: response.status ?? "success",
      data: response.data ?? {},
      toolCalls,
    };
  }

  async evaluate(opts: {
    question: string;
    context: Record<string, unknown>;
    choices: { id: string; description: string }[];
  }): Promise<string | null> {
    // Check if we have a scripted route from the last executed node
    const lastNode = this.callOrder[this.callOrder.length - 1];
    if (lastNode && this.routes[lastNode]) {
      const route = this.routes[lastNode];
      // Validate route is a valid choice
      if (opts.choices.some((c) => c.id === route)) {
        return route;
      }
    }

    // No scripted route: fail closed (same as ClaudeClient.evaluate).
    return null;
  }

  async ask(opts: { instruction: string; context: Record<string, unknown> }): Promise<string> {
    if (this.askFn) return this.askFn(opts.instruction, opts.context);
    return "";
  }

  /**
   * Identify which node is being executed.
   *
   * Strategy:
   * Manual calls without nodeId can match a unique workflow instruction.
   * Legacy mode also permits heuristic/sequential matching for compatibility.
   * Strict mode never guesses from response order or instruction substrings.
   */
  private fixtureFailure(reason: string): NodeResult {
    return {
      status: "failed",
      data: { error: `MockHarness fixture error: ${reason}`, refused: true },
      toolCalls: [],
    };
  }

  private identifyNode(instruction: string): string | null {
    // 1. Instruction-based matching (accurate for branching workflows)
    if (this.instructionMap.size > 0) {
      const matches = this.instructionMap.get(instruction);
      if (this.strict) return matches?.length === 1 ? matches[0]! : null;
      const nodeId = matches?.at(-1);
      if (nodeId && Object.hasOwn(this.responses, nodeId)) return nodeId;
    }
    if (this.strict) return null;

    // 2. Check if any response key appears literally in the instruction
    const keys = Object.keys(this.responses);
    for (const key of keys) {
      if (instruction.toLowerCase().includes(key.toLowerCase()) && !this.callOrder.includes(key)) {
        return key;
      }
    }

    // 3. Sequential fallback: return the next unused key
    const unused = keys.filter((k) => !this.callOrder.includes(k));
    return unused[0] ?? `unknown-${this.callOrder.length}`;
  }
}

/** @deprecated Use {@link MockHarnessOptions}. */
export type MockClaudeOptions = MockHarnessOptions;
/** @deprecated Use {@link MockHarness}. */
export const MockClaude = MockHarness;
/** @deprecated Use {@link MockHarness}. */
export type MockClaude = MockHarness;

// ─── File-based Skill ────────────────────────────────────────────
//
// node:fs and node:path are imported lazily inside createFileSkill()
// so that MockClaude can be imported in browser environments without
// triggering "Module node:fs has been externalized" errors.

import type { Skill } from "./types.js";

/**
 * Create a file-based skill for local testing.
 *
 * Replaces ALL four file providers (observability, issue-tracking,
 * source-control, notification) with a single skill that reads/writes
 * local JSON/markdown files.
 */
export function createFileSkill(outputDir: string): Skill {
  // Lazy-loaded — only resolved when a handler actually runs (Node-only)
  let _fs: typeof import("node:fs") | null = null;
  let _path: typeof import("node:path") | null = null;
  let _resolved: string | null = null;

  async function getFs() {
    if (!_fs) _fs = await import("node:fs");
    return _fs;
  }
  async function getResolved() {
    if (!_path) _path = await import("node:path");
    if (!_resolved) _resolved = _path.resolve(outputDir);
    return { path: _path, resolved: _resolved };
  }

  return {
    id: "filesystem",
    name: "Local Filesystem",
    category: "general" as const,
    description: "Read logs and write issues/PRs/notifications to local files (for testing)",
    config: {},
    tools: [
      {
        name: "fs_read_json",
        access: "read",
        description: "Read and parse a JSON file",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path (absolute or relative to output dir)" },
          },
          required: ["path"],
        },
        handler: async (input: { path: string }) => {
          const fs = await getFs();
          const { path: p, resolved } = await getResolved();
          const filePath = p.isAbsolute(input.path) ? input.path : p.join(resolved, input.path);
          const raw = fs.readFileSync(filePath, "utf-8");
          return JSON.parse(raw);
        },
      },
      {
        name: "fs_read_text",
        access: "read",
        description: "Read a text file",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
          required: ["path"],
        },
        handler: async (input: { path: string }) => {
          const fs = await getFs();
          const { path: p, resolved } = await getResolved();
          const filePath = p.isAbsolute(input.path) ? input.path : p.join(resolved, input.path);
          return fs.readFileSync(filePath, "utf-8");
        },
      },
      {
        name: "fs_write_json",
        access: "write",
        description: "Write a JSON object to a file",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path relative to output dir" },
            data: { type: "object", description: "JSON data to write" },
          },
          required: ["path", "data"],
        },
        handler: async (input: { path: string; data: Record<string, unknown> }) => {
          const fs = await getFs();
          const { path: p, resolved } = await getResolved();
          const filePath = p.join(resolved, input.path);
          fs.mkdirSync(p.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, JSON.stringify(input.data, null, 2), "utf-8");
          return { written: filePath };
        },
      },
      {
        name: "fs_write_markdown",
        access: "write",
        description: "Write a markdown file (for issues, PRs, notifications)",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path relative to output dir" },
            content: { type: "string", description: "Markdown content" },
          },
          required: ["path", "content"],
        },
        handler: async (input: { path: string; content: string }) => {
          const fs = await getFs();
          const { path: p, resolved } = await getResolved();
          const filePath = p.join(resolved, input.path);
          fs.mkdirSync(p.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, input.content, "utf-8");
          return { written: filePath };
        },
      },
      {
        name: "fs_list_dir",
        access: "read",
        description: "List files in a directory",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Directory path relative to output dir" },
          },
        },
        handler: async (input: { path?: string }) => {
          const fs = await getFs();
          const { path: p, resolved } = await getResolved();
          const dirPath = input.path ? p.join(resolved, input.path) : resolved;
          try {
            return fs.readdirSync(dirPath);
          } catch (err: any) {
            return { error: `Failed to list directory: ${err.message}`, files: [] };
          }
        },
      },
    ],
  };
}
