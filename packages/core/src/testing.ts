/**
 * Test Helpers
 *
 * MockClaude for running workflows without an API key.
 * File-based skill for local testing.
 *
 * @example
 * ```ts
 * import { MockClaude, fileSkill } from '@sweny-ai/core/testing'
 *
 * const claude = new MockClaude({
 *   gather: {
 *     toolCalls: [{ tool: 'fs_read_json', input: { path: 'logs.json' } }],
 *     data: { logs: [...] },
 *   },
 *   investigate: {
 *     data: { root_cause: 'NPE in handler', severity: 'high' },
 *   },
 * })
 * ```
 */

import type { Claude, NodeResult, ToolCall, Tool, ToolContext, JSONSchema, Workflow } from "./types.js";
import { consoleLogger } from "./types.js";

// ─── Mock Claude ─────────────────────────────────────────────────

export interface MockNodeResponse {
  /** Tool calls to execute (optional — handlers will be called) */
  toolCalls?: { tool: string; input: Record<string, unknown> }[];
  /** Data to return as the node result */
  data?: Record<string, unknown>;
  /** Status (default: "success") */
  status?: "success" | "skipped" | "failed";
}

export interface MockClaudeOptions {
  /** Node ID → scripted response */
  responses: Record<string, MockNodeResponse>;
  /** Route decisions: "fromNode" → chosen target node ID */
  routes?: Record<string, string>;
  /** Workflow definition — enables instruction-based node matching (required for branching workflows) */
  workflow?: Workflow;
}

/**
 * A mock Claude client that follows a script.
 *
 * For each node, it executes scripted tool calls and returns
 * scripted results. For routing decisions, it follows the
 * routes map or defaults to the first choice.
 */
export class MockClaude implements Claude {
  private callOrder: string[] = [];
  private responses: Record<string, MockNodeResponse>;
  private routes: Record<string, string>;
  private instructionMap: Map<string, string>; // instruction text → node ID

  constructor(opts: MockClaudeOptions) {
    this.responses = opts.responses;
    this.routes = opts.routes ?? {};
    // Build reverse map: instruction → node ID (for accurate matching in branching workflows)
    this.instructionMap = new Map();
    if (opts.workflow) {
      for (const [id, node] of Object.entries(opts.workflow.nodes)) {
        // Source can be a string or an object — only index string instructions
        if (typeof node.instruction === "string") {
          this.instructionMap.set(node.instruction, id);
        }
      }
    }
  }

  /** Returns the order in which nodes were executed */
  get executedNodes(): string[] {
    return [...this.callOrder];
  }

  async run(opts: {
    instruction: string;
    context: Record<string, unknown>;
    tools: Tool[];
    outputSchema?: JSONSchema;
  }): Promise<NodeResult> {
    // Identify which node this is by matching instruction text against responses
    // The executor wraps tools with event tracking, so we can find the node
    // by checking which response key's instruction appears
    const nodeId = this.identifyNode(opts.instruction);
    this.callOrder.push(nodeId);

    const response = this.responses[nodeId];
    if (!response) {
      return {
        status: "success",
        data: { summary: `Mock: no scripted response for "${nodeId}"` },
        toolCalls: [],
      };
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
  }): Promise<string> {
    // Check if we have a scripted route from the last executed node
    const lastNode = this.callOrder[this.callOrder.length - 1];
    if (lastNode && this.routes[lastNode]) {
      const route = this.routes[lastNode];
      // Validate route is a valid choice
      if (opts.choices.some((c) => c.id === route)) {
        return route;
      }
    }

    // Default: first choice
    return opts.choices[0].id;
  }

  /**
   * Identify which node is being executed.
   *
   * Strategy:
   * 1. If a workflow was provided, match by instruction text (accurate for branching)
   * 2. Otherwise, fall back to sequential key matching (works for linear DAGs)
   */
  private identifyNode(instruction: string): string {
    // 1. Instruction-based matching (accurate for branching workflows)
    if (this.instructionMap.size > 0) {
      const nodeId = this.instructionMap.get(instruction);
      if (nodeId && nodeId in this.responses) return nodeId;
    }

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
