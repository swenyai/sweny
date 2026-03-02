import { spawn, execSync } from "node:child_process";

export function execCommand(
  cmd: string,
  args: string[],
  opts?: { env?: Record<string, string>; ignoreReturnCode?: boolean },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: opts?.env ?? process.env,
      stdio: "inherit",
    });

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
