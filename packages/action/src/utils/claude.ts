import * as core from "@actions/core";
import * as exec from "@actions/exec";

/**
 * Install the Claude Code CLI globally via npm.
 */
export async function installClaude(): Promise<void> {
  core.info("Installing Claude Code CLI...");
  await exec.exec("npm", ["install", "-g", "@anthropic-ai/claude-code"]);
  core.info("Claude Code CLI installed");
}

/**
 * Run Claude with a prompt and return exit code.
 * Streams output to Actions log.
 */
export async function runClaude(opts: {
  prompt: string;
  maxTurns: number;
  env?: Record<string, string>;
}): Promise<number> {
  const args = [
    "-p",
    opts.prompt,
    "--allowedTools",
    "*",
    "--dangerously-skip-permissions",
    "--max-turns",
    String(opts.maxTurns),
  ];

  const exitCode = await exec.exec("claude", args, {
    env: { ...process.env, ...opts.env } as Record<string, string>,
    ignoreReturnCode: true,
  });

  return exitCode;
}
