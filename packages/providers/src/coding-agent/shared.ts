import { spawn, execSync } from "node:child_process";
import type { Logger } from "../logger.js";

export interface ExecOptions {
  env?: Record<string, string>;
  ignoreReturnCode?: boolean;
  /** Suppress stdout; pipe stderr through onStderr callback */
  quiet?: boolean;
  onStderr?: (line: string) => void;
  /** Kill process after this many ms. */
  timeoutMs?: number;
}

export function execCommand(cmd: string, args: string[], opts?: ExecOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: opts?.env ?? process.env,
      stdio: opts?.quiet ? ["ignore", "ignore", "pipe"] : "inherit",
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (opts?.timeoutMs) {
      timer = setTimeout(() => {
        child.kill();
        reject(new Error(`${cmd} exceeded timeout (${opts.timeoutMs}ms)`));
      }, opts.timeoutMs);
    }

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

    child.on("error", (err) => {
      if (timer !== undefined) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer !== undefined) clearTimeout(timer);
      if (code !== 0 && !opts?.ignoreReturnCode) {
        reject(new Error(`${cmd} exited with code ${code}`));
      } else {
        resolve(code ?? 0);
      }
    });
  });
}

export interface SpawnLinesOptions {
  env?: Record<string, string>;
  /** Called for each complete stdout line. Async errors are logged, not swallowed. */
  onLine: (line: string) => void | Promise<void>;
  /** Kill process after this many ms. Resolves with -1 on timeout/signal. */
  timeoutMs?: number;
  logger?: Logger;
}

/**
 * Spawns a command, processes stdout line-by-line, forwards stderr to the
 * logger, and resolves with the exit code (-1 if killed by timeout or signal).
 */
export function spawnLines(cmd: string, args: string[], opts: SpawnLinesOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        opts.logger?.warn(`${cmd} exceeded timeout (${opts.timeoutMs}ms) — killing process`);
        child.kill();
      }, opts.timeoutMs);
    }

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
    };

    const dispatchLine = (line: string) => {
      if (!line.trim()) return;
      const result = opts.onLine(line);
      if (result instanceof Promise) {
        result.catch((err: unknown) => {
          opts.logger?.warn(`[${cmd}] event handler error: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    };

    let stdoutBuf = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) dispatchLine(line);
    });
    child.stdout?.on("end", () => {
      if (stdoutBuf) dispatchLine(stdoutBuf);
      stdoutBuf = "";
    });

    // Stderr is forwarded to the logger — never silently discarded.
    let stderrBuf = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) opts.logger?.warn(`[${cmd} stderr] ${line.trim()}`);
      }
    });
    child.stderr?.on("end", () => {
      if (stderrBuf.trim()) opts.logger?.warn(`[${cmd} stderr] ${stderrBuf.trim()}`);
    });

    child.on("error", (err) => {
      cleanup();
      reject(err);
    });
    child.on("close", (code, signal) => {
      cleanup();
      if (signal) {
        opts.logger?.warn(`${cmd} killed by signal ${signal}`);
        resolve(-1);
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
