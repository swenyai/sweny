/**
 * Agent login probes (#339): does the agent a harness drives have a way to
 * authenticate? Each adapter's `preflight()` calls its probe, so `sweny
 * workflow run` and `sweny check` fail before any node runs, with the fix.
 *
 * Presence only. No probe reads a credential's value, and the macOS Keychain
 * probe asks for the entry's attributes, never its secret.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { hasCodexLogin } from "../agent-env.js";

export type AuthProbeResult = { ok: true; via: string } | { ok: false; reason: string };

/** Test seam: adapters take one in their options instead of reading the host. */
export type AuthProbe = () => AuthProbeResult;

/** Same shape as the CLI's other "Missing:" lines; names the agent so the fix is unambiguous. */
export const CLAUDE_CODE_AUTH_HINT =
  "Missing: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`), " +
  "or a Claude Code login (run `claude`, then /login), for --agent claude";

export const CODEX_AUTH_HINT =
  "Missing: OPENAI_API_KEY or CODEX_API_KEY, or a Codex login (`codex login`), for --agent codex";

function set(v: string | undefined): boolean {
  return typeof v === "string" && v.trim() !== "";
}

function truthy(v: string | undefined): boolean {
  if (!set(v)) return false;
  const s = v!.trim().toLowerCase();
  return s !== "0" && s !== "false" && s !== "no" && s !== "off";
}

/**
 * A local Claude Code login: `~/.claude/.credentials.json` (or under
 * `CLAUDE_CONFIG_DIR`) and, on macOS, the Keychain entry (attributes only).
 */
export function detectClaudeCodeLogin(
  opts: {
    env?: Record<string, string | undefined>;
    home?: string;
    platform?: NodeJS.Platform;
    keychainHasLogin?: () => boolean;
  } = {},
): boolean {
  const env = opts.env ?? process.env;
  const home = opts.home ?? os.homedir();
  const platform = opts.platform ?? process.platform;
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  try {
    if (fs.existsSync(path.join(configDir, ".credentials.json"))) return true;
  } catch {
    // fall through
  }
  if (platform === "darwin") {
    const probe =
      opts.keychainHasLogin ??
      (() => {
        const r = spawnSync("security", ["find-generic-password", "-s", "Claude Code-credentials"], {
          stdio: "ignore",
          timeout: 3000,
        });
        return r.status === 0;
      });
    try {
      return probe();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Claude Code auth, the way the spawned agent will see it: Bedrock or Vertex
 * routing, an env credential that survives `SWENY_AUTH` (`oauth` keeps only
 * `CLAUDE_CODE_OAUTH_TOKEN`), or a stored Claude Code login.
 */
export function claudeCodeAuth(
  env: Record<string, string | undefined> = process.env,
  login: () => boolean = () => detectClaudeCodeLogin({ env }),
): AuthProbeResult {
  if (truthy(env.CLAUDE_CODE_USE_BEDROCK)) return { ok: true, via: "Amazon Bedrock" };
  if (truthy(env.CLAUDE_CODE_USE_VERTEX)) return { ok: true, via: "Google Vertex AI" };
  const mode = (env.SWENY_AUTH ?? "").trim().toLowerCase();
  if (set(env.CLAUDE_CODE_OAUTH_TOKEN)) return { ok: true, via: "CLAUDE_CODE_OAUTH_TOKEN" };
  if (mode !== "oauth") {
    if (set(env.ANTHROPIC_API_KEY)) return { ok: true, via: "ANTHROPIC_API_KEY" };
    if (set(env.ANTHROPIC_AUTH_TOKEN)) return { ok: true, via: "ANTHROPIC_AUTH_TOKEN" };
  }
  if (login()) return { ok: true, via: "Claude Code login" };
  return { ok: false, reason: CLAUDE_CODE_AUTH_HINT };
}

/** Codex auth: an API key or access token in env, or a stored `codex login`. */
export function codexAuth(
  env: Record<string, string | undefined> = process.env,
  login: () => boolean = () => hasCodexLogin(env),
): AuthProbeResult {
  for (const k of ["CODEX_API_KEY", "OPENAI_API_KEY", "CODEX_ACCESS_TOKEN"]) {
    if (set(env[k])) return { ok: true, via: k };
  }
  if (login()) return { ok: true, via: "codex login" };
  return { ok: false, reason: CODEX_AUTH_HINT };
}
