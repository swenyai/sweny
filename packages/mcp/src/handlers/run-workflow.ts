import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface RunWorkflowInput {
  workflow: "triage" | "implement";
  /** For implement: issue ID or URL. For triage: ignored (discovers alerts automatically). */
  input?: string;
  cwd?: string;
  dryRun?: boolean;
}

export interface RunWorkflowResult {
  success: boolean;
  output: string;
  error?: string;
}

const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_BUFFER = 1024 * 1024 * 1024; // 1 GB — agentic workflows produce verbose tool call logs

/**
 * Resolve the absolute path to the `sweny` CLI binary.
 * Uses the workspace-linked bin rather than npx to avoid
 * resolution overhead and version mismatch risk.
 */
export function resolveSwenyBin(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // packages/mcp/dist/handlers/ → ../../../../node_modules/.bin/sweny
  return path.resolve(__dirname, "..", "..", "..", "..", "node_modules", ".bin", "sweny");
}

export async function runWorkflow(opts: RunWorkflowInput): Promise<RunWorkflowResult> {
  if (opts.workflow === "implement" && !opts.input) {
    return {
      success: false,
      output: "",
      error: "implement workflow requires an issue ID or URL via the 'input' parameter",
    };
  }

  const args: string[] = [];

  if (opts.workflow === "implement") {
    args.push("implement", opts.input!);
  } else {
    args.push("triage");
  }

  args.push("--json");
  if (opts.dryRun) args.push("--dry-run");

  const cwd = opts.cwd ?? process.cwd();
  const bin = resolveSwenyBin();

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      // Inherit env — sweny CLI needs API keys, .env vars, PATH, etc.
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_BUFFER) stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_BUFFER) stderr += chunk.toString();
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
      if (timedOut) {
        resolve({ success: false, output: stdout, error: "Workflow timed out after 10 minutes" });
      } else if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        resolve({
          success: false,
          output: stdout.trim(),
          error: stderr.trim() || `Process exited with code ${code ?? "unknown (killed by signal)"}`,
        });
      }
    });
  });
}
