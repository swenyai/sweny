import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import type { Command } from "commander";

import { toMermaid, toMermaidBlock } from "../mermaid.js";
import type { Workflow } from "../types.js";
import { triageWorkflow, implementWorkflow, seedContentWorkflow } from "../workflows/index.js";

export interface DiagramOptions {
  direction?: string;
  title?: string;
  block?: boolean;
  output?: string;
}

export interface DiagramDeps {
  /** Load a workflow file (YAML or JSON). Injected so tests can stub. */
  loadWorkflowFile: (file: string) => Workflow;
  /** Commander instance used to detect whether --block was set explicitly. */
  command?: Command;
  /** Stream for success/error messages. Defaults to process.stderr. */
  stderr?: NodeJS.WritableStream;
  /** Stream for diagram output when no --output is set. Defaults to process.stdout. */
  stdout?: NodeJS.WritableStream;
  /** Exit handler. Defaults to process.exit. Tests can throw instead. */
  exit?: (code: number) => void;
}

/**
 * Render a workflow as a Mermaid diagram and write to stdout or a file.
 *
 * Block-default rules (in order of precedence):
 *   1. Explicit `--block` / `--no-block` — always wins (detected via the
 *      Command's option-value source when provided)
 *   2. When `-o` is set, infer from extension: `.mmd` → raw, `.md` → fenced
 *   3. Otherwise default to fenced (matches prior stdout behavior)
 */
export function runWorkflowDiagram(file: string, options: DiagramOptions, deps: DiagramDeps): void {
  const stderr = deps.stderr ?? process.stderr;
  const stdout = deps.stdout ?? process.stdout;
  const exit = deps.exit ?? ((code: number) => process.exit(code));

  let workflow: Workflow;

  // Builtin workflow names
  if (file === "triage") {
    workflow = triageWorkflow;
  } else if (file === "implement") {
    workflow = implementWorkflow;
  } else if (file === "seed-content") {
    workflow = seedContentWorkflow;
  } else {
    try {
      workflow = deps.loadWorkflowFile(file);
    } catch (err) {
      stderr.write(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`) + "\n");
      exit(1);
      return;
    }
  }

  const direction = (options.direction === "LR" ? "LR" : "TB") as "TB" | "LR";
  const title = options.title ?? workflow.name;

  // Explicit --block / --no-block always wins. When commander's source is
  // "cli" or "env" the user (or env var) set it; otherwise we may infer.
  const blockSource = deps.command?.getOptionValueSource("block");
  const blockExplicit = blockSource === "cli" || blockSource === "env";

  let useBlock = options.block !== false;
  if (!blockExplicit && options.output) {
    const ext = path.extname(options.output).toLowerCase();
    if (ext === ".mmd") useBlock = false;
    else if (ext === ".md") useBlock = true;
  }

  const render = useBlock ? toMermaidBlock : toMermaid;
  const output = render(workflow, { direction, title }) + "\n";

  if (options.output) {
    try {
      // Create parent dirs so `-o some/nested/diagram.mmd` works without a
      // separate mkdir — matches `pandoc -o`, `tsc --outFile`, etc.
      const dir = path.dirname(options.output);
      if (dir && dir !== "." && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(options.output, output, "utf8");
      stderr.write(chalk.green(`  ✓ Wrote diagram to ${options.output}`) + "\n");
    } catch (err) {
      stderr.write(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`) + "\n");
      exit(1);
    }
    return;
  }

  stdout.write(output);
}
