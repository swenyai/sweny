import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";

import { toMermaid, toMermaidBlock } from "../mermaid.js";
import type { Workflow } from "../types.js";
import { triageWorkflow, implementWorkflow, seedContentWorkflow } from "../workflows/index.js";

export interface DiagramOptions {
  direction?: string;
  /**
   * Optional diagram title. When omitted we render pure Mermaid with no
   * `---\ntitle: …\n---` frontmatter — the format that `mmdc`, Mermaid Live
   * Editor, and `@mermaid-js/mermaid-cli` all accept as-is.
   */
  title?: string;
  /**
   * Wrap output in a ```mermaid fenced code block. Tri-state:
   *   - `true`  → fenced (forced by explicit `--block`)
   *   - `false` → raw (forced by explicit `--no-block`)
   *   - `undefined` → inferred from `--output` extension; default is raw
   */
  block?: boolean;
  output?: string;
}

export interface DiagramDeps {
  /** Load a workflow file (YAML or JSON). Injected so tests can stub. */
  loadWorkflowFile: (file: string) => Workflow;
  /** Stream for success/error messages. Defaults to process.stderr. */
  stderr?: NodeJS.WritableStream;
  /** Stream for diagram output when no --output is set. Defaults to process.stdout. */
  stdout?: NodeJS.WritableStream;
  /** Exit handler. Defaults to process.exit. Tests can throw instead. */
  exit?: (code: number) => void;
}

const MARKDOWN_EXTS = new Set([".md", ".markdown"]);

/**
 * Resolve whether output should be wrapped in a ```mermaid fenced block.
 *
 * Precedence:
 *   1. Explicit `--block` / `--no-block` always wins.
 *   2. When `-o` points at `.md`/`.markdown` we fence (markdown context).
 *   3. Everything else — stdout, `.mmd`, `.mermaid`, unknown extensions —
 *      emits raw Mermaid syntax that Mermaid CLI / Live Editor / mmdc can
 *      consume directly with no preprocessing.
 */
export function resolveUseBlock(options: DiagramOptions): boolean {
  if (options.block === true) return true;
  if (options.block === false) return false;
  if (options.output) {
    const ext = path.extname(options.output).toLowerCase();
    if (MARKDOWN_EXTS.has(ext)) return true;
  }
  return false;
}

/**
 * Render a workflow as a Mermaid diagram and write to stdout or a file.
 *
 * By default the output is pure Mermaid — no ```mermaid fence, no
 * `---\ntitle: …\n---` frontmatter — so the result is directly consumable
 * by Mermaid CLI (`mmdc`) and the Live Editor. Pass `--block` to wrap in a
 * fenced code block for README embedding, or `--title` to inject a title
 * header for Mermaid renderers that support it.
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
  const useBlock = resolveUseBlock(options);
  const render = useBlock ? toMermaidBlock : toMermaid;

  // Title is opt-in only — an unset `--title` produces no frontmatter. Users
  // who want the workflow.name as title can pass `--title "$(name)"`.
  const renderOpts: { direction: "TB" | "LR"; title?: string } = { direction };
  if (options.title) renderOpts.title = options.title;

  const output = render(workflow, renderOpts) + "\n";

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
