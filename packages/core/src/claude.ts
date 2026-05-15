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

    // Tool-call accounting (Fix #1).
    //
    // Stream-driven recording, correlated by tool_use_id:
    //   - `assistant` message with tool_use block → create a pending ToolCall
    //     and register it in `pendingByUseId` under its tool_use_id.
    //   - `user` message with tool_result block → look up by tool_use_id, set
    //     `status` from `is_error`, and recover the typed output by parsing
    //     the stringified `content` field (our wrapper JSON-stringifies it
    //     before returning; external MCP servers also return structured
    //     content).
    //
    // Keying by tool_use_id (not by tool name) avoids mis-pairing when
    // Claude invokes the same tool in parallel — the self-review test
    // `pairs parallel same-named in-process tool outputs correctly` shows
    // why FIFO-by-name is wrong.
    const toolCalls: ToolCall[] = [];
    const pendingByUseId = new Map<string, ToolCall>();

    // Convert core tools to SDK MCP tools. The wrapper invokes the user's
    // handler and returns `content` via the MCP transport. We do not push
    // to toolCalls from the wrapper — the stream's tool_result is the sole
    // signal of completion, which keeps pairing correct under parallelism.
    const sdkTools = tools.map((t) => coreToolToSdkTool(t, this.defaultContext));

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
          // Tool_use blocks start a ToolCall record. Status + output are
          // filled in when the matching user tool_result arrives.
          const am = message as any;
          if (am.message?.content && Array.isArray(am.message.content)) {
            for (const block of am.message.content) {
              if (block.type === "tool_use") {
                const call: ToolCall = {
                  tool: stripMcpPrefix(block.name ?? ""),
                  input: block.input,
                };
                toolCalls.push(call);
                if (typeof block.id === "string") pendingByUseId.set(block.id, call);
              }
            }
          }
        } else if (message.type === "user") {
          // Tool_result blocks close the loop. Pair to the pending ToolCall
          // by tool_use_id — NOT by name, which would break parallel calls
          // of the same tool (see regression test).
          //
          // Output handling is unified across in-process and external tools:
          // our wrapper JSON-stringifies structured output before returning,
          // and external MCP servers also send structured content as string.
          // We parse the content back into a value so verify's output-path
          // checks work against typed data.
          const um = message as any;
          if (um.message?.content && Array.isArray(um.message.content)) {
            for (const block of um.message.content) {
              if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
              const call = pendingByUseId.get(block.tool_use_id);
              if (!call) continue;
              // Delete after first match so a duplicate tool_result (SDK
              // retry, malformed stream) cannot overwrite a completed call.
              pendingByUseId.delete(block.tool_use_id);

              const isError = block.is_error === true;
              call.status = isError ? "error" : "success";
              const parsed = parseToolResultContent(block.content);
              call.output = isError ? { error: parsed } : parsed;

              // Surface tool errors in the CI log stream at warn level so
              // postmortems don't have to reconstruct them from eval-time
              // tool-call summaries. Without this, "eval failed: tool X
              // did not succeed" never answers the WHY question, because
              // the error body is buried in the per-call output captured
              // only for in-memory verify evaluation.
              if (isError) {
                this.logger.warn(`  tool ${call.tool} failed: ${summarizeToolError(parsed)}`);
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
    const prompt = buildEvaluatePrompt(question, context, choices);

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

  async ask(opts: { instruction: string; context: Record<string, unknown>; model?: string }): Promise<string> {
    const { instruction, context, model } = opts;
    const prompt = [
      instruction,
      Object.keys(context).length > 0 ? `\nContext:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const env = this.buildEnv();
    let response = "";
    const effectiveModel = model ?? this.model;

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
          ...(effectiveModel ? { model: effectiveModel } : {}),
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
 *
 * The wrapper runs the user's handler and returns the MCP `CallToolResult`.
 * Output bookkeeping happens on the stream side (see the tool_result
 * handler in `run()`), keyed by `tool_use_id` — never from inside the
 * wrapper. Keeping the wrapper stateless means parallel calls to the same
 * tool cannot mis-pair outputs.
 */
function coreToolToSdkTool(coreTool: Tool, defaultCtx: ToolContext) {
  const zodShape = jsonSchemaToZodShape(coreTool.input_schema);

  return sdkTool(coreTool.name, coreTool.description, zodShape, async (args: Record<string, unknown>) => {
    try {
      // The executor wraps handlers to inject ToolContext.
      // When used standalone, defaultCtx is the fallback.
      const output = await coreTool.handler(args, defaultCtx);
      // JSON-stringify structured output so the tool_result handler can
      // recover it via parseToolResultContent. Strings pass through.
      return {
        content: [{ type: "text" as const, text: typeof output === "string" ? output : JSON.stringify(output) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });
}

/**
 * Best-effort recovery of typed output from a tool_result's `content`.
 *
 * The MCP protocol sends tool results as string content. Our in-process
 * wrapper JSON-stringifies structured output before returning; external
 * MCP servers generally do the same for JSON payloads. If the string
 * looks like a JSON object or array and parses, return the parsed value
 * so verify's output-path walks work against typed data.
 *
 * Raw strings are preserved verbatim. JSON-primitive strings (e.g. the
 * literal four characters `"42"`) are intentionally NOT parsed — we
 * cannot distinguish a tool that returned the number 42 (wrapper sends
 * `"42"`) from a tool that returned the string "42" (wrapper also sends
 * `"42"`). Preserving the string is safer than guessing.
 */
/**
 * Build the prompt used by `ClaudeClient.evaluate()` to pick a routing edge.
 *
 * Extracted as a pure function so the prompt body can be unit tested without
 * spinning up an SDK query. The body is part of the routing contract: workflow
 * authors and downstream maintainers rely on the model leaning on structured
 * fields rather than prose narrative when picking an edge, especially in the
 * fallback case where a source node did not declare an `output` schema (the
 * executor's schema-strict filter only kicks in when a schema is present;
 * see `buildRouteEvalEntry` in executor.ts).
 *
 * Any change to this prompt should keep:
 *   - The three "Evaluation rules" pointing the model at structured fields
 *     and away from prose narrative.
 *   - A terminal directive to return ONLY the choice ID.
 */
export function buildEvaluatePrompt(
  question: string,
  context: Record<string, unknown>,
  choices: { id: string; description: string }[],
): string {
  const choiceList = choices.map((c) => `- "${c.id}": ${c.description}`).join("\n");
  return [
    question,
    `\nContext:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``,
    `\nChoices:\n${choiceList}`,
    `\nEvaluation rules:`,
    `1. Read each choice's condition literally and match against the structured fields in the context (e.g. status, counts, enum values, boolean flags).`,
    `2. Ignore prose narrative fields ("summary", free-form rationale, conversational commentary). They are not the contract.`,
    `3. When a field's value contradicts what a prose field claims, trust the field's value.`,
    `\nRespond with ONLY the choice ID, nothing else.`,
  ].join("\n");
}

export function parseToolResultContent(content: unknown): unknown {
  if (typeof content !== "string") return content;
  const trimmed = content.trim();
  if (trimmed.length === 0) return content;
  const first = trimmed[0];
  // Only objects and arrays are unambiguous to parse. Strings, numbers,
  // booleans, and null would all corrupt or discard information.
  if (first !== "{" && first !== "[") return content;
  try {
    return JSON.parse(trimmed);
  } catch {
    return content;
  }
}

/**
 * Produce a short, single-line description of a tool-error payload suitable
 * for the CI log stream. The full parsed value stays on the ToolCall for
 * verify and downstream tooling — this is only for inline observability.
 *
 * Collapses newlines, trims whitespace, and caps to 300 chars so a huge
 * API response body doesn't flood the log.
 */
export function summarizeToolError(parsed: unknown): string {
  let raw: string;
  if (typeof parsed === "string") {
    raw = parsed;
  } else if (parsed && typeof parsed === "object") {
    try {
      raw = JSON.stringify(parsed);
    } catch {
      raw = String(parsed);
    }
  } else {
    raw = String(parsed);
  }
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > 300 ? collapsed.slice(0, 297) + "..." : collapsed;
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
