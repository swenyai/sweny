/**
 * SwenyToolBridge wire protocol (#414).
 *
 * The bridge moves skill tool calls from a harness's stdio MCP client to the
 * sweny process that owns the tool handlers:
 *
 *   harness --stdio MCP--> shim (`sweny tool-bridge`) --unix socket--> server (sweny run)
 *
 * The socket carries newline-delimited JSON frames. Every request carries the
 * per-run token; the server rejects a frame with a wrong or missing token and
 * drops the connection.
 *
 * This module also owns the one function that turns a core `Tool` handler
 * outcome into an MCP `CallToolResult`, so the in-process Claude path
 * (`createSdkMcpServer`) and the bridge return byte-identical content and the
 * same `isError` status.
 */

import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { JSONSchema, Tool, ToolContext } from "../../types.js";

export const BRIDGE_PROTOCOL_VERSION = 1;

/** Frames longer than this are refused and the connection is dropped. */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** Env var the shim reads the per-run token from (kept out of argv by default). */
export const TOKEN_ENV = "SWENY_TOOL_BRIDGE_TOKEN";

export type BridgeMethod = "tools/list" | "tools/call";

export interface BridgeRequest {
  v: typeof BRIDGE_PROTOCOL_VERSION;
  id: number;
  token: string;
  method: BridgeMethod;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

export interface BridgeToolDescriptor {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

export interface McpTextContent {
  type: "text";
  text: string;
}

/** The MCP `CallToolResult` subset sweny produces for skill tools. */
export interface McpCallToolResult {
  content: McpTextContent[];
  isError?: true;
}

export type BridgeResponse =
  | { id: number; ok: true; result: { tools: BridgeToolDescriptor[] } | McpCallToolResult }
  | { id: number; ok: false; error: { code: BridgeErrorCode; message: string } };

export type BridgeErrorCode = "unauthorized" | "bad_request" | "unknown_tool" | "internal";

export function encodeFrame(frame: BridgeRequest | BridgeResponse): string {
  return JSON.stringify(frame) + "\n";
}

/**
 * Split a byte stream into newline-delimited JSON frames. Calls `onFrame` with
 * each parsed value (or `undefined` for a line that is not JSON) and
 * `onOverflow` once when a single frame exceeds {@link MAX_FRAME_BYTES}.
 */
export function createFrameReader(
  onFrame: (value: unknown) => void,
  onOverflow: () => void,
  maxBytes = MAX_FRAME_BYTES,
): (chunk: Buffer | string) => void {
  let buf = "";
  let overflowed = false;
  return (chunk) => {
    if (overflowed) return;
    buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim() === "") continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        value = undefined;
      }
      onFrame(value);
    }
    if (Buffer.byteLength(buf, "utf8") > maxBytes) {
      overflowed = true;
      buf = "";
      onOverflow();
    }
  };
}

/** Constant-time token comparison. False for any non-string or length mismatch. */
export function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Structural check of an incoming request frame (token checked separately). */
export function parseRequest(value: unknown): BridgeRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const r = value as Record<string, unknown>;
  if (r.v !== BRIDGE_PROTOCOL_VERSION) return undefined;
  if (typeof r.id !== "number" || !Number.isInteger(r.id)) return undefined;
  if (r.method !== "tools/list" && r.method !== "tools/call") return undefined;
  if (r.params !== undefined && (typeof r.params !== "object" || r.params === null || Array.isArray(r.params))) {
    return undefined;
  }
  return value as BridgeRequest;
}

// ─── Tool result shape (shared with the in-process Claude path) ─────

/** A handler's return value as MCP content. Strings pass through; anything else is JSON. */
export function toolOutputToMcpResult(output: unknown): McpCallToolResult {
  return {
    content: [{ type: "text", text: typeof output === "string" ? output : JSON.stringify(output) }],
  };
}

/** A handler's thrown error as an MCP error result. */
export function toolErrorToMcpResult(err: unknown): McpCallToolResult {
  const message = err instanceof Error ? err.message : (err as { message?: unknown })?.message;
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Validate args against the tool's input schema (the same Zod shape the
 * in-process SDK server validates with), run the handler, and return the MCP
 * result. Invalid args come back as an error result, never reach the handler.
 */
export async function callToolAsMcp(tool: Tool, args: unknown, ctx: ToolContext): Promise<McpCallToolResult> {
  const parsed = z.object(jsonSchemaToZodShape(tool.input_schema)).safeParse(args ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return {
      content: [{ type: "text", text: `Input validation error: invalid arguments for tool ${tool.name}: ${detail}` }],
      isError: true,
    };
  }
  try {
    return toolOutputToMcpResult(await tool.handler(parsed.data, ctx));
  } catch (err) {
    return toolErrorToMcpResult(err);
  }
}

// ─── JSON Schema → Zod conversion ───────────────────────────────

/**
 * Convert a JSON Schema object to a Zod raw shape. The in-process SDK server
 * and the bridge both validate tool args with it, so both paths accept and
 * reject the same inputs and preserve property names, types and descriptions.
 */
export function jsonSchemaToZodShape(schema: JSONSchema): Record<string, z.ZodType> {
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
