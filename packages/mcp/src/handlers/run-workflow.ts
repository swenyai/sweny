import { spawn } from "node:child_process";

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

export async function runWorkflow(opts: RunWorkflowInput): Promise<RunWorkflowResult> {
  const args: string[] = [];

  if (opts.workflow === "implement") {
    args.push("implement", opts.input ?? "");
  } else {
    args.push("triage");
  }

  args.push("--json");
  if (opts.dryRun) args.push("--dry-run");

  const cwd = opts.cwd ?? process.cwd();

  return new Promise((resolve) => {
    const child = spawn("npx", ["sweny", ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ success: false, output: stdout, error: "Workflow timed out after 10 minutes" });
    }, TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, output: "", error: `Failed to spawn sweny: ${err.message}` });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        resolve({
          success: false,
          output: stdout.trim(),
          error: stderr.trim() || `Process exited with code ${code}`,
        });
      }
    });
  });
}
