/**
 * Harness-neutral parsing of agent output: tool results and the final JSON
 * answer. Shared by every adapter so a node's `data` and `toolCalls` mean the
 * same thing whichever harness ran it. Moved out of claude-code.ts unchanged
 * (the contract suite's structured-output golden cases pin the behavior).
 *
 * No agent SDK imports.
 */

import type { JSONSchema, Logger } from "../types.js";

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
 * literal four characters `"42"`) are intentionally NOT parsed - we
 * cannot distinguish a tool that returned the number 42 (wrapper sends
 * `"42"`) from a tool that returned the string "42" (wrapper also sends
 * `"42"`). Preserving the string is safer than guessing.
 */

export function parseToolResultContent(content: unknown): unknown {
  // The Anthropic tool_result `content` field can be a block array
  // (e.g. [{type:"text",text:"..."}, ...]) rather than a string. When it is,
  // concatenate the text of every {type:"text"} block (recursing through any
  // nested content), then run the same object/array JSON-parse logic on the
  // joined string. This keeps `call.output` the actual payload instead of the
  // raw wrapper array that eval/route logic would otherwise have to walk.
  if (Array.isArray(content)) {
    const text = collectBlockText(content);
    return parseJsonObjectOrArray(text);
  }
  if (typeof content !== "string") return content;
  return parseJsonObjectOrArray(content);
}

/**
 * Parse a string only when it is an unambiguous JSON object or array.
 *
 * Strings, numbers, booleans, and null would all corrupt or discard
 * information (we cannot distinguish the literal text `"42"` from the number
 * 42), so non-object/array inputs are preserved verbatim.
 */
function parseJsonObjectOrArray(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.length === 0) return content;
  const first = trimmed[0];
  if (first !== "{" && first !== "[") return content;
  try {
    return JSON.parse(trimmed);
  } catch {
    return content;
  }
}

/**
 * Concatenate the text of an array of content blocks. Handles {type:"text"}
 * blocks and recurses into any nested `content` array so deeply-wrapped tool
 * results still flatten to their underlying text.
 */
function collectBlockText(blocks: unknown[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      parts.push(b.text);
    } else if (Array.isArray(b.content)) {
      parts.push(collectBlockText(b.content));
    } else if (typeof b.text === "string") {
      // Some producers omit an explicit type but still carry text.
      parts.push(b.text);
    }
  }
  return parts.join("");
}

/**
 * Produce a short, single-line description of a tool-error payload suitable
 * for the CI log stream. The full parsed value stays on the ToolCall for
 * verify and downstream tooling - this is only for inline observability.
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

// ─── JSON extraction ────────────────────────────────────────────

/**
 * Extract a JSON object from an agent's final text response.
 *
 * Strategy (in order):
 * 1. LAST ```json code block``` - models put their real final answer last, so
 *    a prompt-injected fake fenced block placed earlier must not win.
 * 2. Last brace-delimited `{...}` block - handles inline JSON at end of text
 * 3. Full text parse - for responses that are pure JSON
 * 4. Empty object - safe fallback
 *
 * When `outputSchema` is supplied, the parsed object is checked against it.
 * A mismatch is logged (warning) rather than silently accepted, so a
 * non-conforming model answer is at least attributable.
 */
export function tryParseJSON(
  text: string,
  outputSchema?: JSONSchema,
  logger?: Pick<Logger, "warn">,
  label = "Claude",
): Record<string, unknown> {
  if (!text) return {};

  const finalize = (parsed: Record<string, unknown>): Record<string, unknown> => {
    if (outputSchema) {
      const problems = schemaMismatches(parsed, outputSchema);
      if (problems.length > 0) {
        logger?.warn?.(`${label} output did not conform to outputSchema: ${problems.join("; ")}`);
      }
    }
    return parsed;
  };

  // 1. Code block - scan ALL fenced blocks, prefer the LAST that parses.
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (let i = fences.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(fences[i][1].trim());
      if (typeof parsed === "object" && parsed !== null) return finalize(parsed);
    } catch {
      /* try the next-earlier fence, then fall through to brace scan */
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
          if (typeof parsed === "object" && parsed !== null) return finalize(parsed);
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
    if (typeof parsed === "object" && parsed !== null) return finalize(parsed);
  } catch {
    /* fall through */
  }

  return {};
}

/**
 * Lightweight structural check of a parsed object against a JSON Schema.
 *
 * Deliberately shallow: it verifies `required` keys are present and that the
 * top-level `type` and each declared property `type` match. It does NOT do
 * full JSON Schema validation (no `$ref`, `oneOf`, formats, nested arrays).
 * The contract here is "flag an obviously non-conforming object" so a mismatch
 * is logged rather than silently accepted; it is not a validation gate.
 *
 * Returns a list of human-readable problems; empty means no detected mismatch.
 */
function schemaMismatches(value: unknown, schema: JSONSchema): string[] {
  const problems: string[] = [];
  const s = schema as Record<string, unknown>;

  if (s.type === "object" || s.properties || s.required) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [`expected an object, got ${Array.isArray(value) ? "array" : typeof value}`];
    }
    const obj = value as Record<string, unknown>;

    const required = Array.isArray(s.required) ? (s.required as string[]) : [];
    for (const key of required) {
      if (!(key in obj) || obj[key] === undefined) {
        problems.push(`missing required property "${key}"`);
      }
    }

    const props = (s.properties as Record<string, unknown>) ?? {};
    for (const [key, propSchema] of Object.entries(props)) {
      if (!(key in obj) || obj[key] === undefined || obj[key] === null) continue;
      const expected = (propSchema as Record<string, unknown>)?.type;
      if (typeof expected === "string" && !jsonTypeMatches(obj[key], expected)) {
        problems.push(`property "${key}" expected ${expected}, got ${jsonTypeOf(obj[key])}`);
      }
    }
  } else if (typeof s.type === "string" && !jsonTypeMatches(value, s.type)) {
    problems.push(`expected ${s.type}, got ${jsonTypeOf(value)}`);
  }

  return problems;
}

function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function jsonTypeMatches(value: unknown, expected: string): boolean {
  switch (expected) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true; // unknown/unsupported type keyword - don't flag
  }
}
