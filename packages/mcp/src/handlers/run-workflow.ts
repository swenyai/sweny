import { accessSync, constants, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCustomWorkflowFile } from "./list-workflows.js";

export interface RunWorkflowInput {
  /**
   * Which workflow to run. The built-ins "triage" and "implement" dispatch via
   * their dedicated CLI subcommands; any other value is treated as a custom
   * workflow id and resolved to its file under `.sweny/workflows/`, then run
   * via `sweny workflow run <file>`.
   */
  workflow: string;
  /** For implement: issue ID or URL. For triage: ignored (discovers alerts automatically). */
  input?: string;
  cwd?: string;
  dryRun?: boolean;
  /** Called with parsed NDJSON stream events for real-time progress. */
  onProgress?: (event: Record<string, unknown>) => void;
}

export interface RunWorkflowResult {
  success: boolean;
  output: string;
  error?: string;
}

const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_STDERR_BUFFER = 10 * 1024 * 1024; // 10 MB — stderr is error output, not verbose logs

/**
 * How to invoke the `sweny` CLI: a command plus any leading args.
 *
 * The preferred form is `{ command: process.execPath, prefixArgs: [absBin] }`,
 * i.e. run the resolved core CLI entry through the current Node binary. This
 * does not depend on the file's executable bit, a shebang resolving, or `sweny`
 * being on PATH — all of which are unreliable under `npx -y @sweny-ai/mcp`.
 */
export interface SwenyInvocation {
  command: string;
  prefixArgs: string[];
}

const requireFromHere = createRequire(import.meta.url);

/**
 * Resolve how to invoke the `sweny` CLI, most-robust strategy first:
 *
 *  1. Resolve `@sweny-ai/core/package.json` from this module's dependency tree
 *     (createRequire), read `bin.sweny`, and run it via `process.execPath`.
 *     This is the only path that works reliably under `npx -y @sweny-ai/mcp`,
 *     where the bin is in an ephemeral cache not on the spawned child's PATH
 *     and the monorepo-relative `.bin` arithmetic misses.
 *  2. Monorepo workspace-linked bin at node_modules/.bin/sweny (dev/local).
 *  3. Bare command name `sweny`, resolved from PATH (last resort, e.g. a global
 *     install).
 */
export function resolveSwenyInvocation(): SwenyInvocation {
  // (1) Resolve core's declared bin from the installed dependency tree.
  try {
    const corePkgPath = requireFromHere.resolve("@sweny-ai/core/package.json");
    const corePkg = JSON.parse(readFileSync(corePkgPath, "utf-8")) as {
      bin?: string | Record<string, string>;
    };
    const binRel = typeof corePkg.bin === "string" ? corePkg.bin : corePkg.bin?.sweny;
    if (binRel) {
      const absBin = path.resolve(path.dirname(corePkgPath), binRel);
      accessSync(absBin, constants.R_OK);
      return { command: process.execPath, prefixArgs: [absBin] };
    }
  } catch {
    // Fall through to the monorepo / PATH fallbacks.
  }

  // (2) Monorepo workspace-linked bin.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // packages/mcp/dist/handlers/ → ../../../../node_modules/.bin/sweny
  const monorepo = path.resolve(__dirname, "..", "..", "..", "..", "node_modules", ".bin", "sweny");
  try {
    accessSync(monorepo, constants.X_OK);
    return { command: monorepo, prefixArgs: [] };
  } catch {
    // (3) Bare name from PATH.
    return { command: "sweny", prefixArgs: [] };
  }
}

export async function runWorkflow(opts: RunWorkflowInput): Promise<RunWorkflowResult> {
  if (opts.workflow === "implement" && !opts.input?.trim()) {
    return {
      success: false,
      output: "",
      error: "implement workflow requires an issue ID or URL via the 'input' parameter",
    };
  }

  const cwd = opts.cwd ?? process.cwd();
  const args: string[] = [];

  if (opts.workflow === "triage") {
    args.push("triage");
  } else if (opts.workflow === "implement") {
    args.push("implement", opts.input!.trim());
  } else {
    // Custom workflow: resolve its id to a file under .sweny/workflows/ and run
    // it via `sweny workflow run <file>`. Constraining resolution to that
    // directory keeps the spawn surface narrow (no arbitrary paths).
    const file = await resolveCustomWorkflowFile(cwd, opts.workflow);
    if (!file) {
      return {
        success: false,
        output: "",
        error: `Workflow "${opts.workflow}" was not found in .sweny/workflows/. Use sweny_list_workflows to see runnable workflows.`,
      };
    }
    args.push("workflow", "run", file);
    if (opts.input?.trim()) args.push("--input", opts.input.trim());
  }

  args.push("--json", "--stream");
  if (opts.dryRun) args.push("--dry-run");

  const { command, prefixArgs } = resolveSwenyInvocation();

  return new Promise((resolve) => {
    const child = spawn(command, [...prefixArgs, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      // Inherit env — sweny CLI needs API keys, .env vars, PATH, etc.
    });

    let stderr = "";
    let lineBuf = "";
    let lastJsonLine = "";

    // Parse stdout line-by-line: each line is either an NDJSON stream event
    // or (the last valid JSON) the final --json result.
    child.stdout.on("data", (chunk: Buffer) => {
      lineBuf += chunk.toString();
      const parts = lineBuf.split("\n");
      lineBuf = parts.pop()!; // keep incomplete trailing fragment
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.type && opts.onProgress) {
            try {
              opts.onProgress(parsed);
            } catch {
              // Progress is best-effort — don't break the stream
            }
          }
          lastJsonLine = trimmed;
        } catch {
          // Non-JSON line — ignore (progress spinner output, etc.)
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BUFFER) stderr += chunk.toString();
    });

    // Single settled guard prevents double-resolve from any event combination:
    // error+close, timeout+close, or normal close.
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, TIMEOUT_MS);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ success: false, output: "", error: `Failed to spawn sweny CLI: ${err.message}` });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      // Process any remaining buffered data
      if (lineBuf.trim()) {
        try {
          const parsed = JSON.parse(lineBuf.trim());
          if (parsed.type && opts.onProgress) {
            try {
              opts.onProgress(parsed);
            } catch {
              // Progress is best-effort
            }
          }
          lastJsonLine = lineBuf.trim();
        } catch {
          // Not JSON
        }
      }

      if (timedOut) {
        resolve({ success: false, output: lastJsonLine, error: "Workflow timed out after 10 minutes" });
      } else if (code === 0) {
        resolve({ success: true, output: lastJsonLine });
      } else {
        resolve({
          success: false,
          output: lastJsonLine,
          error: stderr.trim() || `Process exited with code ${code ?? "unknown (killed by signal)"}`,
        });
      }
    });
  });
}
