import chalk from "chalk";

import type { ExecutionEvent, NodeResult, Observer, ToolCall } from "../types.js";

// Default truncation, large enough to fit a 14-item validation checklist JSON
// without losing the bottom (passed/failed totals). Overridable via env var
// for ad-hoc debugging when even this isn't enough.
const TRUNCATE = Number.parseInt(process.env.SWENY_VERBOSE_TRUNCATE ?? "4000", 10) || 4000;

function truncate(s: string): string {
  return s.length > TRUNCATE
    ? `${s.slice(0, TRUNCATE)}\n      ${chalk.dim(`… [${s.length - TRUNCATE} more chars]`)}`
    : s;
}

function fmt(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function indent(s: string): string {
  return s.split("\n").join("\n      ");
}

function printCall(call: ToolCall): void {
  process.stderr.write(`    ${chalk.dim("→")} ${chalk.cyan(call.tool)} ${chalk.dim("(input)")}\n`);
  process.stderr.write(`      ${chalk.dim(indent(truncate(fmt(call.input))))}\n`);
  const status = call.status === "error" ? chalk.red("(output, error)") : chalk.dim("(output)");
  process.stderr.write(`    ${chalk.dim("←")} ${chalk.cyan(call.tool)} ${status}\n`);
  process.stderr.write(`      ${chalk.dim(indent(truncate(fmt(call.output))))}\n`);
}

function printData(node: string, data: NodeResult["data"]): void {
  if (!data || Object.keys(data).length === 0) return;
  process.stderr.write(`    ${chalk.bold.dim(`${node}: output`)}\n`);
  process.stderr.write(`      ${chalk.dim(indent(truncate(fmt(data))))}\n`);
}

/**
 * Create an observer that prints, on `node:exit`:
 *   1. Every tool call's input and output (truncated).
 *   2. The node's structured output (`result.data`) — the payload that
 *      conditional edges route on. Without this, "validate → notify_halt"
 *      with no failing checks looks like a paradox; with it, you can see
 *      that the node emitted `{ status: "fail" }` and root-cause the wrong
 *      decision.
 *
 * Both kinds of tools are covered (skill-registered AND Claude Code's
 * built-in Bash/Read/Edit/Write), because `result.toolCalls` is populated
 * after the node completes regardless of how the call was dispatched.
 *
 * Truncation defaults to 4000 chars per side. Override with the
 * `SWENY_VERBOSE_TRUNCATE` env var for ad-hoc debugging. Use `--stream` for
 * the full untruncated NDJSON.
 */
export function createVerboseToolObserver(): Observer {
  return (event: ExecutionEvent) => {
    if (event.type !== "node:exit") return;
    const calls = event.result.toolCalls;
    if (calls.length > 0) {
      process.stderr.write(
        `    ${chalk.bold.dim(`${event.node}: ${calls.length} tool call${calls.length === 1 ? "" : "s"}`)}\n`,
      );
      for (const call of calls) printCall(call);
    }
    printData(event.node, event.result.data);
  };
}
