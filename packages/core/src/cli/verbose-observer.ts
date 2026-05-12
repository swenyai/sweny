import chalk from "chalk";

import type { ExecutionEvent, Observer, ToolCall } from "../types.js";

const TRUNCATE = 1200;

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

/**
 * Create an observer that prints each tool call's input and output to stderr
 * in a human-readable form. Useful when debugging a node that fails or routes
 * unexpectedly — the default human output only shows step transitions,
 * leaving "why" invisible.
 *
 * Emission strategy: print the full call list on `node:exit` rather than per
 * `tool:call`/`tool:result` event. The reason: the executor's tool:call and
 * tool:result events fire only for skill-registered tools, not for the
 * Claude Code subprocess's built-in tools (Bash, Read, Edit, etc.). Those
 * built-in tools — the ones agents actually use most — land in
 * `result.toolCalls` only after the node completes. Walking result.toolCalls
 * on node:exit covers both kinds and avoids partial visibility.
 *
 * Inputs and outputs are truncated; use `--stream` for full untruncated
 * NDJSON.
 */
export function createVerboseToolObserver(): Observer {
  return (event: ExecutionEvent) => {
    if (event.type !== "node:exit") return;
    const calls = event.result.toolCalls;
    if (calls.length === 0) return;
    process.stderr.write(
      `    ${chalk.bold.dim(`${event.node}: ${calls.length} tool call${calls.length === 1 ? "" : "s"}`)}\n`,
    );
    for (const call of calls) {
      printCall(call);
    }
  };
}
