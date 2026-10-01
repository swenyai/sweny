/**
 * The answer at the end of `sweny workflow run`: the terminal node's result
 * (or the failed node's error), rendered for a human.
 *
 * Unlike run-history and the receipt, this DOES read node output. It is
 * local-only: printed to the terminal and saved to
 * `.sweny/runs/<run-id>/output.md`. Nothing here is sent to the cloud.
 */

import fs from "node:fs";
import path from "node:path";
import type { JSONSchema, NodeResult, Workflow } from "../types.js";
import { RUN_HISTORY_DIR } from "./run-history.js";

/** Lines of the answer printed to the terminal before the rest is left in output.md. */
export const FINAL_OUTPUT_MAX_LINES = 60;

export interface FinalOutput {
  kind: "result" | "error";
  /** Node id the text came from. */
  node: string;
  /** Rendered lines, uncapped. */
  lines: string[];
}

type Schema = Record<string, unknown>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function isEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0) ||
    (isObj(v) && Object.keys(v).length === 0)
  );
}

function scalar(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

function indentLines(lines: string[], pad: string): string[] {
  return lines.map((l) => (l === "" ? l : pad + l));
}

/** One value as lines under a label: `key: value`, or `key:` plus an indented block. */
function renderField(label: string, value: unknown, schema: Schema | undefined): string[] {
  if (Array.isArray(value)) {
    const itemSchema = isObj(schema?.items) ? (schema!.items as Schema) : undefined;
    const out: string[] = [`${label}:`];
    for (const item of value) out.push(...renderListItem(item, itemSchema));
    return out;
  }
  if (isObj(value)) {
    return [`${label}:`, ...indentLines(renderObject(value, schema), "  ")];
  }
  const text = scalar(value);
  if (!text.includes("\n")) return [`${label}: ${text}`];
  return [`${label}:`, ...indentLines(text.split("\n"), "  ")];
}

function renderListItem(item: unknown, schema: Schema | undefined): string[] {
  if (isObj(item)) {
    const inner = renderObject(item, schema);
    if (inner.length === 0) return [];
    return [`- ${inner[0]}`, ...indentLines(inner.slice(1), "  ")];
  }
  if (Array.isArray(item)) {
    return [`- ${item.map(scalar).join(", ")}`];
  }
  const text = scalar(item);
  const [first, ...rest] = text.split("\n");
  return [`- ${first}`, ...indentLines(rest, "  ")];
}

/** Declared fields first (schema order), then none of the extras: the schema is the contract. */
function renderObject(data: Record<string, unknown>, schema: Schema | undefined): string[] {
  const props = isObj(schema?.properties) ? (schema!.properties as Record<string, unknown>) : undefined;
  const keys = props ? Object.keys(props) : Object.keys(data);
  const out: string[] = [];
  for (const key of keys) {
    const value = data[key];
    if (isEmpty(value)) continue;
    const propSchema = props && isObj(props[key]) ? (props[key] as Schema) : undefined;
    const title = typeof propSchema?.title === "string" && propSchema.title.trim() ? propSchema.title.trim() : key;
    out.push(...renderField(title, value, propSchema));
  }
  return out;
}

/** Render a node's declared output fields as a compact `key: value` block. Empty when nothing declared is present. */
export function renderSchemaOutput(data: Record<string, unknown>, schema: JSONSchema): string[] {
  const props = (schema as Schema).properties;
  if (!isObj(props) || Object.keys(props).length === 0) return [];
  return renderObject(data, schema as Schema);
}

function trimBlock(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").trim().split("\n");
  return lines.map((l) => l.replace(/\s+$/, ""));
}

/**
 * Pick what the user should see: the last-run terminal node's result on
 * success, the first failed node's error on failure. Null when there is
 * nothing to show (no schema fields and no summary text).
 */
export function resolveFinalOutput(workflow: Workflow, results: Map<string, NodeResult>): FinalOutput | null {
  for (const [id, r] of results) {
    if (r.status !== "failed") continue;
    const err = r.data?.error;
    const text = typeof err === "string" && err.trim() !== "" ? err : "node failed";
    return { kind: "error", node: id, lines: trimBlock(text) };
  }

  const hasOutgoing = new Set(workflow.edges.map((e) => e.from));
  const succeeded = [...results].filter(([, r]) => r.status === "success");
  const terminal = succeeded.filter(([id]) => !hasOutgoing.has(id));
  // Walk back from the end: the last node that actually yields something wins.
  const candidates = [...(terminal.length > 0 ? terminal : succeeded)].reverse();
  for (const [id, r] of candidates) {
    const schema = workflow.nodes[id]?.output;
    let lines: string[] = [];
    if (schema) lines = renderSchemaOutput(r.data ?? {}, schema);
    if (lines.length === 0) {
      const summary = r.data?.summary;
      if (typeof summary === "string" && summary.trim() !== "") lines = trimBlock(summary);
    }
    if (lines.length > 0) return { kind: "result", node: id, lines };
  }
  return null;
}

/**
 * Terminal text: the first `maxLines` lines, then
 * `... (N more lines, see .sweny/runs/<id>/output.md)`. When no file was
 * saved the pointer is dropped, never invented.
 */
export function formatFinalOutput(
  out: FinalOutput,
  opts: { maxLines?: number; outputPath?: string | null } = {},
): string {
  const max = opts.maxLines ?? FINAL_OUTPUT_MAX_LINES;
  const shown = out.lines.slice(0, max);
  const hidden = out.lines.length - shown.length;
  if (hidden > 0) {
    const noun = hidden === 1 ? "line" : "lines";
    shown.push(
      opts.outputPath ? `... (${hidden} more ${noun}, see ${opts.outputPath})` : `... (${hidden} more ${noun})`,
    );
  }
  return shown.map((l) => (l === "" ? "" : `  ${l}`)).join("\n");
}

/** Markdown saved to output.md: the full, uncapped answer. */
export function formatFinalMarkdown(workflow: Workflow, out: FinalOutput): string {
  const nodeName = workflow.nodes[out.node]?.name ?? out.node;
  const head = out.kind === "error" ? `# ${workflow.name}: ${nodeName} failed` : `# ${workflow.name}`;
  return `${head}\n\n${out.lines.join("\n")}\n`;
}

/** Relative path shown to the user: `.sweny/runs/<id>/output.md`. */
export function outputRelPath(runId: string): string {
  return path.posix.join(...RUN_HISTORY_DIR.split(path.sep), runId, "output.md");
}

/** Write output.md. Local only. Returns the relative path, or null on failure. Never throws. */
export function writeFinalOutput(runId: string, markdown: string, cwd: string = process.cwd()): string | null {
  try {
    const rel = outputRelPath(runId);
    const file = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, markdown);
    return rel;
  } catch {
    return null;
  }
}
