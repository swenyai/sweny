import { spawn, execSync } from "node:child_process";

export interface ExecOptions {
  env?: Record<string, string>;
  ignoreReturnCode?: boolean;
  /** Suppress stdout; pipe stderr through onStderr callback */
  quiet?: boolean;
  onStderr?: (line: string) => void;
}

export function execCommand(cmd: string, args: string[], opts?: ExecOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: opts?.env ?? process.env,
      stdio: opts?.quiet ? ["ignore", "ignore", "pipe"] : "inherit",
    });

    if (opts?.quiet && child.stderr) {
      let buf = "";
      child.stderr.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) opts.onStderr?.(line.trim());
        }
      });
      child.stderr.on("end", () => {
        if (buf.trim()) opts.onStderr?.(buf.trim());
      });
    }

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0 && !opts?.ignoreReturnCode) {
        reject(new Error(`${cmd} exited with code ${code}`));
      } else {
        resolve(code ?? 0);
      }
    });
  });
}

export function isCliInstalled(cmd: string): boolean {
  try {
    execSync(`${cmd} --version`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
