import { accessSync, constants } from "node:fs";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface RunWorkflowInput {
  workflow: "triage" | "implement";
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
 * Resolve the path to the `sweny` CLI binary.
 *
 * In the monorepo, the workspace-linked bin at node_modules/.bin/sweny is
 * preferred for speed and version consistency. When installed standalone via
 * npm, that path won't exist — fall back to the bare command name so the OS
 * resolves it from PATH (which works because @sweny-ai/core declares a bin).
 */
export function resolveSwenyBin(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // packages/mcp/dist/handlers/ → ../../../../node_modules/.bin/sweny
  const monorepo = path.resolve(__dirname, "..", "..", "..", "..", "node_modules", ".bin", "sweny");
  try {
    accessSync(monorepo, constants.X_OK);
    return monorepo;
  } catch {
    return "sweny";
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

  const args: string[] = [];

  if (opts.workflow === "implement") {
    args.push("implement", opts.input!.trim());
  } else {
    args.push("triage");
  }

  args.push("--json", "--stream");
  if (opts.dryRun) args.push("--dry-run");

  const cwd = opts.cwd ?? process.cwd();
  const bin = resolveSwenyBin();

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
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
