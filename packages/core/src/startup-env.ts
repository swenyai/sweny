/**
 * The process environment as it was before sweny read any workspace file.
 *
 * The workspace is agent-writable, and its `.env` (cli/config-file.ts
 * `loadDotenv`) may set any variable the real environment left unset. The
 * privileged git push (skills/git-push.ts) must not take its PATH, proxy or CA
 * settings, or the server it sends the token to, from a value the workspace
 * introduced. This module is imported by config-file.ts, so the snapshot is
 * taken when the module graph loads, before `loadDotenv()` runs.
 *
 * Node only.
 */

const SNAPSHOT: Readonly<NodeJS.ProcessEnv> = Object.freeze({ ...process.env });

/** Variable names a workspace file wrote into `process.env` after startup. */
const introduced = new Set<string>();

/** The environment captured at process startup, before any workspace file was read. */
export function startupEnv(): Readonly<NodeJS.ProcessEnv> {
  return SNAPSHOT;
}

/** Record that a workspace file (`.env`) set `key` in `process.env`. */
export function markWorkspaceEnv(key: string): void {
  introduced.add(key);
}

/** Test seam: forget that a workspace file set `key`. */
export function unmarkWorkspaceEnv(key: string): void {
  introduced.delete(key);
}

/**
 * The value of `key` the privileged path may use. From `process.env` itself
 * (the CLI's run env) it is always the startup value. From a caller-built env
 * it is the caller's value, unless a workspace file introduced the key (a copy
 * of `process.env` taken after `loadDotenv`), which yields the startup value.
 */
export function trustedEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (env === process.env || introduced.has(key)) return SNAPSHOT[key];
  return env[key];
}
