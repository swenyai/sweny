/**
 * Claude Client — Headless Claude Code backend
 *
 * Uses the @anthropic-ai/claude-agent-sdk to run headless Claude Code
 * as the LLM backend. Tools are exposed via an in-process MCP server
 * that Claude Code calls during execution.
 *
 * This is the ONLY supported LLM backend. The whole point of sweny
 * is to use headless Claude Code — never the raw Anthropic API.
 */

import { query, createSdkMcpServer, tool as sdkTool, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Claude, Tool, ToolContext, NodeResult, ToolCall, JSONSchema, Logger, McpServerConfig } from "./types.js";
import { consoleLogger } from "./types.js";

const SYSTEM_PROMPT = `You are a step in an automated workflow. Execute the instruction precisely using the tools available to you. Be thorough but concise. When you're done, summarize your findings and results.`;

export interface ClaudeClientOptions {
  /** Model override */
  model?: string;
  /** Max turns for tool use loop (default: 20) */
  maxTurns?: number;
  /** Working directory for Claude Code (default: process.cwd()) */
  cwd?: string;
  /** Logger */
  logger?: Logger;
  /** Default tool context for standalone usage (not via executor) */
  defaultContext?: ToolContext;
  /** External MCP servers (GitHub, Linear, Sentry, etc.) — merged with core skill tools */
  mcpServers?: Record<string, McpServerConfig>;
}

export class ClaudeClient implements Claude {
  private model: string | undefined;
  private maxTurns: number;
  private cwd: string;
  private logger: Logger;
  private defaultContext: ToolContext;
  private mcpServers: Record<string, McpServerConfig>;

  constructor(opts: ClaudeClientOptions = {}) {
    this.model = opts.model;
    this.maxTurns = opts.maxTurns ?? 20;
    this.cwd = opts.cwd ?? process.cwd();
    this.logger = opts.logger ?? consoleLogger;
    this.defaultContext = opts.defaultContext ?? { config: {}, logger: this.logger };
    this.mcpServers = opts.mcpServers ?? {};
  }

  /**
   * Build env for the Claude Code subprocess.
   * OAuth token takes priority over API key to prevent .env files from
   * overriding the user's subscription-based auth.
   */
  private buildEnv(): Record<string, string> {
    const env: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] != null),
    );
    if (env.CLAUDE_CODE_OAUTH_TOKEN) {
      delete env.ANTHROPIC_API_KEY;
    }
    return env;
  }

  async run(opts: {
    instruction: string;
    context: Record<string, unknown>;
    tools: Tool[];
    outputSchema?: JSONSchema;
    onProgress?: (message: string) => void;
    maxTurns?: number;
  }): Promise<NodeResult> {
    const { instruction, context, tools, outputSchema, onProgress, maxTurns } = opts;
    const toolCalls: ToolCall[] = [];

    // Convert core tools to SDK MCP tools
    const sdkTools = tools.map((t) => coreToolToSdkTool(t, this.defaultContext, toolCalls));

    // Create in-process MCP server
    const mcpServer = createSdkMcpServer({
      name: "sweny-core",
      tools: sdkTools,
    });

    // Build prompt
    const prompt = [
      `## Instruction\n\n${instruction}`,
      `## Context\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``,
      outputSchema
        ? `## Required Output\n\nYou MUST end with a JSON object matching this schema:\n\`\`\`json\n${JSON.stringify(outputSchema, null, 2)}\n\`\`\``
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const env = this.buildEnv();

    let response = "";

    try {
      const allMcpServers: Record<string, any> = { ...this.mcpServers };
      if (sdkTools.length > 0) allMcpServers["sweny-core"] = mcpServer;

      const stream = query({
        prompt,
        options: {
          maxTurns: maxTurns ?? this.maxTurns,
          systemPrompt: SYSTEM_PROMPT,
          cwd: this.cwd,
          env,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          stderr: (data: string) => this.logger.debug(`[claude-code] ${data}`),
          ...(this.model ? { model: this.model } : {}),
          ...(Object.keys(allMcpServers).length > 0 ? { mcpServers: allMcpServers } : {}),
        },
      });

      for await (const message of stream) {
        if (message.type === "tool_progress") {
          const tp = message as any;
          if (tp.tool_name && typeof tp.elapsed_time_seconds === "number") {
            const name = stripMcpPrefix(tp.tool_name);
            const secs = Math.round(tp.elapsed_time_seconds);
            onProgress?.(`${name} (${secs}s)`);
          }
        } else if (message.type === "tool_use_summary") {
          const ts = message as any;
          if (ts.summary) {
            const clean = ts.summary.replace(/\n/g, " ").trim();
            onProgress?.(clean.length > 80 ? clean.slice(0, 79) + "\u2026" : clean);
          }
        } else if (message.type === "assistant") {
          // Extract tool_use blocks from assistant messages (MCP tool calls)
          const am = message as any;
          if (am.message?.content && Array.isArray(am.message.content)) {
            for (const block of am.message.content) {
              if (block.type === "tool_use") {
                toolCalls.push({
                  tool: stripMcpPrefix(block.name ?? ""),
                  input: block.input,
                });
              }
            }
          }
        } else if (message.type === "result") {
          const resultMsg = message as SDKResultMessage;
          if (resultMsg.subtype === "success" && "result" in resultMsg) {
            // terminal_reason was added in @anthropic-ai/claude-agent-sdk v0.2.91.
            // When the turn budget is exhausted the SDK still emits subtype='success'
            // but sets terminal_reason='max_turns'. Treat anything other than
            // 'completed' (or absent) as a failure so callers are not silently fed
            // incomplete output.
            const terminalReason = (resultMsg as any).terminal_reason as string | undefined;
            if (terminalReason && terminalReason !== "completed") {
              return {
                status: "failed",
                data: { error: `Claude query terminated early: ${terminalReason}` },
                toolCalls,
              };
            }
            response = resultMsg.result;
          } else if ("errors" in resultMsg) {
            const errors = (resultMsg as any).errors as string[] | undefined;
            return {
              status: "failed",
              data: { error: errors?.join("\n") ?? "Execution failed" },
              toolCalls,
            };
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Claude Code query failed: ${err.message}`);
      return {
        status: "failed",
        data: { error: err.message },
        toolCalls,
      };
    }

    return {
      status: "success",
      data: { summary: response, ...tryParseJSON(response) },
      toolCalls,
    };
  }

  async evaluate(opts: {
    question: string;
    context: Record<string, unknown>;
    choices: { id: string; description: string }[];
  }): Promise<string> {
    const { question, context, choices } = opts;
    const choiceList = choices.map((c) => `- "${c.id}": ${c.description}`).join("\n");

    const prompt = [
      question,
      `\nContext:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``,
      `\nChoices:\n${choiceList}`,
      `\nRespond with ONLY the choice ID, nothing else.`,
    ].join("\n");

    const env = this.buildEnv();

    let response = "";

    try {
      const stream = query({
        prompt,
        options: {
          maxTurns: 1,
          cwd: this.cwd,
          env,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          stderr: (data: string) => this.logger.debug(`[claude-code] ${data}`),
          ...(this.model ? { model: this.model } : {}),
        },
      });

      for await (const message of stream) {
        if (message.type === "result") {
          const resultMsg = message as SDKResultMessage;
          if (resultMsg.subtype === "success" && "result" in resultMsg) {
            response = resultMsg.result;
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`Evaluate query failed: ${err.message}. Falling back to first choice.`);
      return choices[0].id;
    }

    const text = response.trim().replace(/^["']|["']$/g, "");
    const validIds = choices.map((c) => c.id);

    // Exact match
    if (validIds.includes(text)) return text;

    // Fuzzy — look for an ID embedded in the response
    const match = validIds.find((id) => text.includes(id));
    if (match) return match;

    // Fallback
    this.logger.warn(`Could not parse route choice from: "${text.slice(0, 100)}". Falling back to first choice.`);
    return validIds[0];
  }

  async ask(opts: { instruction: string; context: Record<string, unknown> }): Promise<string> {
    const { instruction, context } = opts;
    const prompt = [
      instruction,
      Object.keys(context).length > 0 ? `\nContext:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const env = this.buildEnv();
    let response = "";

    try {
      const stream = query({
        prompt,
        options: {
          maxTurns: 1,
          cwd: this.cwd,
          env,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          stderr: (data: string) => this.logger.debug(`[claude-code] ${data}`),
          ...(this.model ? { model: this.model } : {}),
        },
      });

      for await (const message of stream) {
        if (message.type === "result") {
          const resultMsg = message as SDKResultMessage;
          if (resultMsg.subtype === "success" && "result" in resultMsg) {
            response = resultMsg.result;
          } else {
            this.logger.warn(
              `claude.ask: SDK returned non-success subtype "${resultMsg.subtype}" — returning empty string`,
            );
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`Ask query failed: ${err.message}`);
      return "";
    }

    return response.trim();
  }
}

// ─── Tool conversion ────────────────────────────────────────────

/**
 * Convert a core Tool to an SDK MCP tool definition.
 * Bridges JSON Schema → Zod and wraps the handler to return CallToolResult.
 */
function coreToolToSdkTool(coreTool: Tool, defaultCtx: ToolContext, toolCalls: ToolCall[]) {
  const zodShape = jsonSchemaToZodShape(coreTool.input_schema);

  return sdkTool(coreTool.name, coreTool.description, zodShape, async (args: Record<string, unknown>) => {
    try {
      // The executor wraps handlers to inject ToolContext.
      // When used standalone, defaultCtx is the fallback.
      const output = await coreTool.handler(args, defaultCtx);
      toolCalls.push({ tool: coreTool.name, input: args, output });
      return {
        content: [{ type: "text" as const, text: typeof output === "string" ? output : JSON.stringify(output) }],
      };
    } catch (err: any) {
      toolCalls.push({ tool: coreTool.name, input: args, output: { error: err.message } });
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });
}

// ─── JSON Schema → Zod conversion ───────────────────────────────

/**
 * Convert a JSON Schema object to a Zod raw shape for the agent SDK.
 * Preserves property names, types, and descriptions so Claude sees
 * accurate tool parameters through the MCP protocol.
 */
function jsonSchemaToZodShape(schema: JSONSchema): Record<string, z.ZodType> {
  const props = (schema as any)?.properties ?? {};
  const required = new Set<string>((schema as any)?.required ?? []);
  const shape: Record<string, z.ZodType> = {};

  for (const [key, prop] of Object.entries(props)) {
    let zodType = jsonPropertyToZod(prop as Record<string, unknown>);
    if (!required.has(key)) {
      zodType = zodType.optional();
    }
    shape[key] = zodType;
  }

  return shape;
}

function jsonPropertyToZod(prop: Record<string, unknown>): z.ZodType {
  if (!prop || typeof prop !== "object") return z.unknown();

  const desc = typeof prop.description === "string" ? prop.description : undefined;

  switch (prop.type) {
    case "string": {
      if (prop.enum && Array.isArray(prop.enum)) {
        const e = z.enum(prop.enum as [string, ...string[]]);
        return desc ? e.describe(desc) : e;
      }
      const s = z.string();
      return desc ? s.describe(desc) : s;
    }
    case "number":
    case "integer": {
      const n = z.number();
      return desc ? n.describe(desc) : n;
    }
    case "boolean": {
      const b = z.boolean();
      return desc ? b.describe(desc) : b;
    }
    case "array": {
      const items = prop.items ? jsonPropertyToZod(prop.items as Record<string, unknown>) : z.unknown();
      const a = z.array(items);
      return desc ? a.describe(desc) : a;
    }
    case "object": {
      if (prop.properties && typeof prop.properties === "object") {
        const nested = jsonSchemaToZodShape(prop as JSONSchema);
        const o = z.object(nested);
        return desc ? o.describe(desc) : o;
      }
      const r = z.record(z.string(), z.unknown());
      return desc ? r.describe(desc) : r;
    }
    default: {
      const u = z.unknown();
      return desc ? u.describe(desc) : u;
    }
  }
}

/** Strip MCP server prefix: "mcp__server__tool" → "tool" */
function stripMcpPrefix(name: string): string {
  const parts = name.split("__");
  if (parts.length >= 3 && parts[0] === "mcp") return parts.slice(2).join("__");
  return name;
}

// ─── JSON extraction ────────────────────────────────────────────

/**
 * Extract a JSON object from Claude's text response.
 *
 * Strategy (in order):
 * 1. ```json code block``` — most reliable, Claude often wraps JSON this way
 * 2. Last brace-delimited `{...}` block — handles inline JSON at end of text
 * 3. Full text parse — for responses that are pure JSON
 * 4. Empty object — safe fallback
 */
function tryParseJSON(text: string): Record<string, unknown> {
  if (!text) return {};

  // 1. Code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      /* try next strategy */
    }
  }

  // 2. Last brace-delimited block (scan backwards for matching braces)
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace !== -1) {
    let depth = 0;
    for (let i = lastBrace; i >= 0; i--) {
      if (text[i] === "}") depth++;
      else if (text[i] === "{") depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(i, lastBrace + 1));
          if (typeof parsed === "object" && parsed !== null) return parsed;
        } catch {
          /* try next strategy */
        }
        break;
      }
    }
  }

  // 3. Full text parse
  try {
    const parsed = JSON.parse(text.trim());
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    /* fall through */
  }

  return {};
}
