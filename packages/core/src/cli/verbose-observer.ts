import chalk from "chalk";

import type { ExecutionEvent, Observer } from "../types.js";

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

/**
 * Create an observer that prints each tool call's input and output to stderr
 * inline, in a human-readable format. Useful when debugging a node that's
 * failing — the default human output only shows step transitions, leaving
 * "why" invisible. Inputs and outputs are truncated to keep the log readable;
 * use `--stream` for the full untruncated NDJSON.
 */
export function createVerboseToolObserver(): Observer {
  return (event: ExecutionEvent) => {
    switch (event.type) {
      case "tool:call":
        process.stderr.write(`    ${chalk.dim("→")} ${chalk.cyan(event.tool)} ${chalk.dim("(input)")}\n`);
        process.stderr.write(`      ${chalk.dim(indent(truncate(fmt(event.input))))}\n`);
        break;
      case "tool:result":
        process.stderr.write(`    ${chalk.dim("←")} ${chalk.cyan(event.tool)} ${chalk.dim("(output)")}\n`);
        process.stderr.write(`      ${chalk.dim(indent(truncate(fmt(event.output))))}\n`);
        break;
    }
  };
}
