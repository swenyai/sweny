import { accessSync, constants, readFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
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
 * In-flight `sweny` CLI subprocesses, tracked so the MCP server can terminate
 * them during shutdown. A workflow run can hold a child for up to 10 minutes;
 * without this registry, a client that exits or is killed mid-run would orphan
 * that child (re-parented to launchd/init), leaking a process that keeps
 * running long after the server it served is gone.
 */
const activeChildren = new Set<ChildProcess>();

/**
 * Send a signal to every in-flight workflow child. Called by the server on
 * shutdown (SIGINT/SIGTERM, or stdin EOF when the client disconnects).
 * Best-effort: a child that has already exited is a harmless no-op.
 */
export function terminateActiveWorkflows(signal: NodeJS.Signals = "SIGTERM"): void {
  for (const child of activeChildren) {
    try {
      child.kill(signal);
    } catch {
      // Already gone — nothing to terminate.
    }
  }
}

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

    // Track for shutdown-time termination; removed when the child settles below.
    activeChildren.add(child);

    let stderr = "";
    let lineBuf = "";
    let terminalJson = "";
    let invalidTerminal = false;
    const decoder = new StringDecoder("utf8");
    let jsonLines: string[] = [];
    let depth = 0;
    let inString = false;
    let escaped = false;

    // Events are NDJSON, but the CLI's terminal result is pretty-printed JSON.
    // Frame whole JSON values before parsing, never their nested lines. Tracking
    // strings keeps braces in node output from prematurely ending a value.
    function consumeLine(line: string): void {
      // Logger prefixes such as [info] and {progress must not open a JSON
      // frame. CLI documents are objects, starting with { alone or a key.
      if (jsonLines.length === 0 && !/^\s*\{\s*(?:"|\}|$)/.test(line)) return;
      jsonLines.push(line);
      for (const char of line) {
        if (inString) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') inString = false;
        } else if (char === '"') inString = true;
        else if (char === "{" || char === "[") depth++;
        else if (char === "}" || char === "]") depth--;
      }
      if (depth > 0 || inString) return;

      const json = jsonLines.join("\n");
      jsonLines = [];
      depth = 0;
      inString = false;
      escaped = false;
      try {
        const parsed: unknown = JSON.parse(json);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          invalidTerminal = true;
          return;
        }
        const value = parsed as Record<string, unknown>;
        if (typeof value.type === "string") {
          try {
            opts.onProgress?.(value);
          } catch {
            // Progress is best-effort; a callback cannot break result parsing.
          }
        } else if (
          Object.values(value).every(
            (node) =>
              node !== null &&
              typeof node === "object" &&
              !Array.isArray(node) &&
              ["success", "skipped", "failed"].includes((node as Record<string, unknown>).status as string),
          )
        ) {
          terminalJson = JSON.stringify(value);
          invalidTerminal = false;
        } else {
          invalidTerminal = true;
        }
      } catch {
        invalidTerminal = true;
      }
    }

    function consumeText(text: string): void {
      lineBuf += text;
      const parts = lineBuf.split("\n");
      lineBuf = parts.pop()!; // keep incomplete trailing fragment
      for (const line of parts) consumeLine(line);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      consumeText(decoder.write(chunk));
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
      activeChildren.delete(child);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ success: false, output: "", error: `Failed to spawn sweny CLI: ${err.message}` });
    });

    child.on("close", (code) => {
      activeChildren.delete(child);
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      consumeText(decoder.end());
      if (lineBuf.trim()) consumeLine(lineBuf);
      if (jsonLines.length > 0) invalidTerminal = true;

      if (timedOut) {
        resolve({ success: false, output: terminalJson, error: "Workflow timed out after 10 minutes" });
      } else if (code === 0) {
        if (!terminalJson || invalidTerminal) {
          resolve({
            success: false,
            output: terminalJson,
            error: invalidTerminal
              ? "Sweny CLI emitted invalid or incomplete terminal JSON"
              : "Sweny CLI exited without a terminal JSON result",
          });
        } else {
          resolve({ success: true, output: terminalJson });
        }
      } else {
        resolve({
          success: false,
          output: terminalJson,
          error: stderr.trim() || `Process exited with code ${code ?? "unknown (killed by signal)"}`,
        });
      }
    });
  });
}
