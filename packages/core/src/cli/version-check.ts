import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import chalk from "chalk";

import { compareVersions, fetchLatestFromNpm } from "./upgrade.js";

/**
 * Passive "a new sweny is out" nudge. Runs as a commander `postAction` hook
 * so every command prints at most one dim footer line when behind.
 *
 * Design goals:
 *   1. Never block the user's command. Cache reads are sync; network refresh
 *      happens inline but bounded to a tight budget — if the registry is slow
 *      we swallow the error silently and try again in 24h.
 *   2. Never nag in contexts where nobody's watching — CI, pipes, or when the
 *      user has explicitly opted out.
 *   3. Never fire from inside `sweny upgrade` itself (would double-print the
 *      upgrade hint right before/after running the install).
 */

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Budget for the background registry refresh. Short on purpose. */
export const REFRESH_BUDGET_MS = 1500;

export interface CacheEntry {
  latest: string;
  checkedAt: number;
}

export interface VersionCheckDeps {
  currentVersion: string;
  cachePath: string;
  now: number;
  env: NodeJS.ProcessEnv;
  isTty: boolean;
  /** The command the user ran, so we can suppress the nudge for self-referential commands. */
  commandName?: string;
  stderr?: NodeJS.WritableStream;
  fetchLatestVersion?: (tag: string) => Promise<string>;
  /** Injected so tests can make the refresh synchronous + deterministic. */
  now_fn?: () => number;
}

/**
 * Decide whether any version-check work should run at all. We bail early for:
 *   - `CI=1`: noise in pipelines and reads tokens
 *   - `SWENY_NO_UPDATE_CHECK=1`: explicit opt-out
 *   - `SWENY_OFFLINE=1`: users behind airgaps
 *   - Non-TTY stderr: scripts and pipes
 *   - `upgrade` / `update` commands: the command itself handles the hint
 */
export function shouldSkip(env: NodeJS.ProcessEnv, isTty: boolean, commandName: string | undefined): boolean {
  if (env.CI) return true;
  if (env.SWENY_NO_UPDATE_CHECK) return true;
  if (env.SWENY_OFFLINE) return true;
  if (!isTty) return true;
  if (commandName === "upgrade" || commandName === "update") return true;
  return false;
}

export function readCache(cachePath: string): CacheEntry | null {
  try {
    const raw = fs.readFileSync(cachePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CacheEntry>;
    if (typeof parsed.latest !== "string" || typeof parsed.checkedAt !== "number") {
      return null;
    }
    if (parsed.latest.length === 0) return null;
    return { latest: parsed.latest, checkedAt: parsed.checkedAt };
  } catch {
    return null;
  }
}

export function writeCache(cachePath: string, entry: CacheEntry): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(entry));
  } catch {
    // Cache-write failures are non-fatal — we'll just retry next run.
  }
}

export function isCacheFresh(entry: CacheEntry, now: number, ttl: number = CACHE_TTL_MS): boolean {
  return now - entry.checkedAt < ttl;
}

export function formatNudge(current: string, latest: string): string {
  return chalk.dim(`  › sweny ${latest} is available (you have ${current}). Run \`sweny upgrade\``);
}

/**
 * Resolve the cache path on disk. Honors `XDG_CACHE_HOME` and falls back to
 * `~/.cache/sweny/version-check.json`. We isolate this so tests can inject a
 * tmpdir without touching the real cache.
 */
export function defaultCachePath(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const xdg = env.XDG_CACHE_HOME && env.XDG_CACHE_HOME.length > 0 ? env.XDG_CACHE_HOME : path.join(home, ".cache");
  return path.join(xdg, "sweny", "version-check.json");
}

/**
 * Run the check. Prints a nudge if the cache shows a newer version, then
 * refreshes the cache in the background if it's stale or missing.
 *
 * The refresh is awaited with a short timeout so we don't hang the CLI, but
 * we also don't surface its result on *this* run — that keeps the code paths
 * simple and avoids "first run after install" printing a nudge before the
 * user's command finishes rendering.
 */
export async function maybeNudge(deps: VersionCheckDeps): Promise<void> {
  if (shouldSkip(deps.env, deps.isTty, deps.commandName)) return;

  const stderr = deps.stderr ?? process.stderr;
  const cache = readCache(deps.cachePath);

  if (cache && compareVersions(deps.currentVersion, cache.latest) < 0) {
    stderr.write(formatNudge(deps.currentVersion, cache.latest) + "\n");
  }

  if (cache && isCacheFresh(cache, deps.now)) return;

  // Stale or missing — refresh in the background with a hard timeout. We
  // race the fetch against a timer so the process can exit promptly even if
  // the registry hangs.
  const fetchFn = deps.fetchLatestVersion ?? fetchLatestFromNpm;
  try {
    const latest = await Promise.race<string | null>([
      fetchFn("latest").catch(() => null),
      new Promise<null>((resolve) => {
        const t = setTimeout(() => resolve(null), REFRESH_BUDGET_MS);
        // Don't keep the event loop alive purely for this timer.
        if (typeof (t as unknown as { unref?: () => void }).unref === "function") {
          (t as unknown as { unref: () => void }).unref();
        }
      }),
    ]);
    if (latest) {
      writeCache(deps.cachePath, { latest, checkedAt: deps.now });
    }
  } catch {
    // Swallow — network hiccups shouldn't be user-visible here.
  }
}
