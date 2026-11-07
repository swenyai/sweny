/**
 * Probes behind `AgentHarness.diagnose()` (#532), the agent lines of `sweny
 * check`. Read-only and cheap: env and file presence, a CLI's own version or
 * status command, and HTTP requests that list models (no model call, no
 * tokens). Nothing here prints a credential value.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import type { HarnessCheck } from "./types.js";

/** Per-probe timeout: a hung connect or CLI must not make `sweny check` hang. */
export const CHECK_TIMEOUT_MS = 5000;

/** The executable a bare command resolves to on `env.PATH`, or the command itself when it is a path. */
export function resolveOnPath(command: string, env: Record<string, string | undefined>): string | undefined {
  const ok = (p: string) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (command.includes(path.sep) || command.includes("/")) return ok(command) ? command : undefined;
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const p = path.join(dir, command);
    if (ok(p)) return p;
  }
  return undefined;
}

/** Redact a URL to scheme + host so userinfo / query (which can carry a key) never logs. */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "(invalid URL)";
  }
}

export function networkErrorMessage(err: unknown, timeoutMs = CHECK_TIMEOUT_MS): string {
  // AbortSignal.timeout fires a DOMException with name "TimeoutError"; an
  // explicit abort surfaces as "AbortError". Either means we gave up waiting.
  const errName = err instanceof Error ? err.name : "";
  if (errName === "TimeoutError" || errName === "AbortError") {
    return `Connection timed out after ${timeoutMs}ms - host unreachable or too slow`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(msg)) {
    return `Network error - check your internet connection (${msg})`;
  }
  return msg;
}

/**
 * The CLI line: the adapter's own version check (its `preflight` result, so
 * the binary resolves and parses exactly as a run would) plus where it lives.
 */
export function cliCheck(
  name: string,
  command: string,
  env: Record<string, string | undefined>,
  pre: { ok: true; version: string } | { ok: false; reason: string },
  note?: string,
): HarnessCheck {
  if (!pre.ok) return { name, status: "fail", detail: pre.reason };
  const where = resolveOnPath(command, env);
  return { name, status: "ok", detail: [pre.version, where && `(${where})`, note].filter(Boolean).join(" ") };
}

export interface CliRun {
  /** Exit code; null when the process could not start or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process could not start (ENOENT) or timed out. */
  error?: string;
}

/** Run a CLI subcommand with a timeout. Never throws; output is for parsing, not printing. */
export function runCli(
  command: string,
  args: string[],
  opts: { env?: Record<string, string | undefined>; timeoutMs?: number } = {},
): Promise<CliRun> {
  const env = Object.fromEntries(
    Object.entries(opts.env ?? process.env).filter((e): e is [string, string] => e[1] != null),
  );
  return new Promise((resolve) => {
    execFile(command, args, { env, timeout: opts.timeoutMs ?? CHECK_TIMEOUT_MS }, (err, stdout, stderr) => {
      const out = { stdout: String(stdout ?? ""), stderr: String(stderr ?? "") };
      if (!err) return resolve({ code: 0, ...out });
      const e = err as NodeJS.ErrnoException & { code?: unknown; killed?: boolean };
      if (typeof e.code === "number") return resolve({ code: e.code, ...out });
      resolve({ code: null, ...out, error: e.killed ? `timed out after ${opts.timeoutMs ?? CHECK_TIMEOUT_MS}ms` : e.message });
    });
  });
}

// ─── Upstream probes (list models: no model call, no tokens) ─────

/** `GET <base>/models` with an OpenAI key (Codex). */
export async function checkOpenAI(
  apiKey: string,
  envName: string,
  baseUrl = "https://api.openai.com/v1",
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<HarnessCheck> {
  const name = "OpenAI API (codex agent)";
  const safeBase = redactUrl(baseUrl);
  try {
    const res = await fetch(baseUrl.replace(/\/+$/, "") + "/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 200) return { name, status: "ok", detail: `${envName} is valid (${safeBase})` };
    if (res.status === 401 || res.status === 403) {
      return {
        name,
        status: "fail",
        detail: `${res.status} from ${safeBase} - check ${envName} at https://platform.openai.com/api-keys`,
      };
    }
    return { name, status: "fail", detail: `Unexpected HTTP ${res.status} from ${safeBase}` };
  } catch (err) {
    return { name, status: "fail", detail: networkErrorMessage(err, timeoutMs) };
  }
}

/** Which credential `sweny check` should validate for Claude, mirroring resolveAuthEnv intent. */
export type CheckAuthMode = "oauth" | "api-key" | "auth-token" | "none";

export interface ClaudeCheckAuth {
  anthropicApiKey: string;
  anthropicAuthToken: string;
  claudeOauthToken: string;
  swenyAuth: "auto" | "api-key" | "oauth";
}

export function resolveCheckAuthMode(config: ClaudeCheckAuth): CheckAuthMode {
  const hasKey = !!config.anthropicApiKey;
  const hasBearer = !!config.anthropicAuthToken;
  const hasOauth = !!config.claudeOauthToken;
  if (config.swenyAuth === "oauth") return hasOauth ? "oauth" : "none";
  if (config.swenyAuth === "api-key") return hasKey ? "api-key" : hasBearer ? "auth-token" : "none";
  // auto: OAuth wins when present (today's protective behavior)
  if (hasOauth) return "oauth";
  if (hasKey) return "api-key";
  if (hasBearer) return "auth-token";
  return "none";
}

/** `GET https://api.anthropic.com/v1/models` with an API key. */
export async function checkAnthropic(apiKey: string, timeoutMs = CHECK_TIMEOUT_MS): Promise<HarnessCheck> {
  const name = "Anthropic (claude agent)";
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 200) {
      return { name, status: "ok", detail: "API key is valid" };
    }
    if (res.status === 401) {
      return {
        name,
        status: "fail",
        detail: "401 Unauthorized - check ANTHROPIC_API_KEY at https://console.anthropic.com",
      };
    }
    return { name, status: "fail", detail: `Unexpected HTTP ${res.status}` };
  } catch (err) {
    return { name, status: "fail", detail: networkErrorMessage(err, timeoutMs) };
  }
}

/** Probe an Anthropic-compatible gateway, never real Anthropic with a gateway-bound key. */
export async function checkAnthropicGateway(
  base: string,
  config: Pick<ClaudeCheckAuth, "anthropicApiKey" | "anthropicAuthToken" | "claudeOauthToken">,
  mode: CheckAuthMode,
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<HarnessCheck> {
  const name = "Anthropic (gateway)";
  const safeBase = redactUrl(base);
  const headers: Record<string, string> = { "anthropic-version": "2023-06-01" };
  if (mode === "api-key") {
    headers["x-api-key"] = config.anthropicApiKey;
  } else {
    // auth-token or oauth against the gateway
    headers.Authorization = `Bearer ${config.anthropicAuthToken || config.claudeOauthToken}`;
  }
  try {
    const url = base.replace(/\/+$/, "") + "/v1/models";
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    // Gateways vary on whether /v1/models exists; reachable + non-auth-error is good enough.
    if (res.ok || res.status === 404) {
      return { name, status: "ok", detail: `gateway reachable (${safeBase}), auth mode: ${mode}` };
    }
    if (res.status === 401 || res.status === 403) {
      return { name, status: "fail", detail: `${res.status} from gateway ${safeBase}, check gateway credentials` };
    }
    return { name, status: "fail", detail: `Unexpected HTTP ${res.status} from gateway ${safeBase}` };
  } catch (err) {
    return { name, status: "fail", detail: networkErrorMessage(err, timeoutMs) };
  }
}

/**
 * Claude Code's `sweny check` line, unchanged from before #532: a stored
 * login, an upstream probe for an API key or a gateway, or a skip that names
 * the auth mode.
 */
export async function diagnoseClaudeCode(opts: {
  env: Record<string, string | undefined>;
  hasLogin: () => boolean;
  timeoutMs?: number;
}): Promise<HarnessCheck[]> {
  const { env } = opts;
  const raw = (env.SWENY_AUTH ?? "").trim().toLowerCase();
  const auth: ClaudeCheckAuth = {
    anthropicApiKey: env.ANTHROPIC_API_KEY || "",
    anthropicAuthToken: env.ANTHROPIC_AUTH_TOKEN || "",
    claudeOauthToken: env.CLAUDE_CODE_OAUTH_TOKEN || "",
    swenyAuth: raw === "api-key" || raw === "oauth" ? raw : "auto",
  };
  const mode = resolveCheckAuthMode(auth);
  const base = env.ANTHROPIC_BASE_URL || "";
  const name = "Anthropic (claude agent)";
  if (mode === "none" && opts.hasLogin()) return [{ name, status: "ok", detail: "Claude Code login detected" }];
  if (mode === "none") return [{ name, status: "skip", detail: "No credential configured" }];
  if (base) return [await checkAnthropicGateway(base, auth, mode, opts.timeoutMs)];
  if (mode === "api-key") return [await checkAnthropic(auth.anthropicApiKey, opts.timeoutMs)];
  // oauth or auth-token, no base URL: nothing cheap to probe, report the mode.
  return [{ name, status: "skip", detail: `auth mode: ${mode}, skipping upstream API check` }];
}
