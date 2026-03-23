/**
 * Environment variable validation for the open-source SWEny worker.
 *
 * Required vars are validated at startup — the process exits immediately with
 * a clear error message if any are missing, rather than failing mid-job.
 */

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(
      `[env] Missing required environment variable: ${name}\n` + `  Set ${name} before starting the worker.`,
    );
  }
  return val;
}

function parseIntEnv(name: string, defaultVal: number): number {
  const raw = process.env[name];
  if (!raw) return defaultVal;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 1) {
    throw new Error(`[env] ${name} must be a positive integer, got: ${JSON.stringify(raw)}`);
  }
  return parsed;
}

function parseCodingAgent(raw: string | undefined): "claude" | "codex" | "gemini" {
  if (!raw) return "claude";
  if (raw === "claude" || raw === "codex" || raw === "gemini") return raw;
  throw new Error(`[env] CODING_AGENT must be one of "claude", "codex", or "gemini", got: ${JSON.stringify(raw)}`);
}

export interface Env {
  /** BullMQ Redis connection URL */
  REDIS_URL: string;
  /** Base URL for the sweny.ai internal API (secrets + result submission) */
  INTERNAL_API_URL: string;
  /** BullMQ queue name (default: "sweny-jobs") */
  QUEUE_NAME: string;
  /** Worker concurrency (default: 1) */
  CONCURRENCY: number;
  /** Coding agent to use (default: "claude") */
  CODING_AGENT: "claude" | "codex" | "gemini";
}

function loadEnv(): Env {
  try {
    return {
      REDIS_URL: requireEnv("REDIS_URL"),
      INTERNAL_API_URL: requireEnv("INTERNAL_API_URL"),
      QUEUE_NAME: process.env["QUEUE_NAME"] ?? "sweny-jobs",
      CONCURRENCY: parseIntEnv("CONCURRENCY", 1),
      CODING_AGENT: parseCodingAgent(process.env["CODING_AGENT"]),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n${msg}\n\n`);
    process.exit(1);
  }
}

export const env: Env = loadEnv();
