/**
 * sweny-side branch push for `github_create_pr` (#473).
 *
 * With `actions/checkout`'s recommended `persist-credentials: false` the
 * checkout holds no token, so the agent's own `git push` in the create_pr node
 * has nothing to push with. sweny pushes the PR's head branch itself, from
 * the sweny process, with the github skill's token (`GITHUB_TOKEN`), right
 * before it opens the PR. The agent never holds the token.
 *
 * The checkout is agent-written, so nothing in it may run, or steer the push,
 * while the token is in play. The push therefore never runs in the checkout:
 *
 * 1. Read-only git in the checkout, with no token in its env, resolves the
 *    head commit, checks that every fetch and push URL of `origin` is the PR's
 *    repo on the GitHub server, and finds the object store.
 * 2. A private temporary bare repo borrows those objects (`alternates`, data
 *    only) and gets one ref, the head commit.
 * 3. git pushes from that repo, with no system or global config, an empty
 *    hooks dir, `--no-verify` and no credential helper, to an explicit URL
 *    built from the PR's repo (`<server>/<owner>/<repo>.git`) with an explicit
 *    refspec. No agent-written config, hook, push URL or `insteadOf` is read.
 *    The token goes to git as command-scope config in the child env, never
 *    argv, and only on this one invocation.
 *
 * The git binary, its PATH, the proxy and CA settings and the server URL come
 * from the environment captured at process startup (startup-env.ts), never
 * from a value the workspace `.env` introduced, and git is run by an absolute
 * path that lies outside the workspace, the temp dir and any directory this
 * user can write (see {@link resolveTrustedGit}).
 *
 * Guard rails: only a local branch that exists, only when origin is the PR's
 * own repo, never force, never the base branch or the repo's default branch
 * (from the GitHub API, not the checkout's `origin/HEAD`).
 * A push that fails is logged and the PR is still requested: the agent may
 * already have pushed (persisted credentials, an `agent_env` grant).
 */

import { execFile } from "node:child_process";
import {
  accessSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { devNull } from "node:os";
import * as path from "node:path";
import { startupEnv, startupTmpdir, trustedEnvValue } from "../startup-env.js";
import type { BranchPusher } from "../types.js";

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<GitRunResult>;

/** True when `child` is `dir` or inside it. */
function inside(dir: string, child: string): boolean {
  const rel = path.relative(dir, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** True when this user can write `dir` or any directory above it. */
function writableChain(dir: string): boolean {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    try {
      accessSync(d, fsConstants.W_OK);
      return true;
    } catch {
      // Not writable: check the parent.
    }
    if (path.dirname(d) === d) return false;
  }
}

/**
 * Whether `dir` may hold the git sweny runs with the token: absolute, outside
 * the workspace and the temp dir, and not writable by this user at any level
 * (the agent runs as this user). The writability check is skipped as root,
 * where the agent could replace any binary anyway, and on Windows, where
 * `access(W_OK)` only reads the read-only attribute: there the sandbox is the
 * boundary.
 */
function trustedDir(dir: string, workspace: string): boolean {
  if (!dir || !path.isAbsolute(dir)) return false;
  const r = real(dir);
  const ws = real(workspace);
  const tmp = real(startupTmpdir());
  for (const d of [path.resolve(dir), r]) {
    if (inside(ws, d) || inside(path.resolve(workspace), d) || inside(tmp, d)) return false;
  }
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  if (!root && process.platform !== "win32" && (writableChain(dir) || writableChain(r))) return false;
  return true;
}

/** The trusted entries of a PATH value, in order (see {@link trustedDir}). */
export function trustedPathDirs(pathValue: string | undefined, workspace: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of (pathValue ?? "").split(path.delimiter)) {
    if (seen.has(d) || !trustedDir(d, workspace)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

/**
 * The absolute path of the first `git` on `pathValue` (the startup PATH) whose
 * directory, and whose resolved file and its directory, pass
 * {@link trustedDir}. Undefined when there is none: nothing is pushed.
 */
export function resolveTrustedGit(pathValue: string | undefined, workspace: string): string | undefined {
  const names = process.platform === "win32" ? ["git.exe"] : ["git"];
  for (const dir of trustedPathDirs(pathValue, workspace)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, fsConstants.X_OK);
      } catch {
        continue;
      }
      const file = real(candidate);
      if (!trustedDir(path.dirname(file), workspace)) continue;
      if (process.platform !== "win32" && !(typeof process.getuid === "function" && process.getuid() === 0)) {
        try {
          accessSync(file, fsConstants.W_OK);
          continue; // A git binary this user can rewrite is not trusted.
        } catch {
          // Not writable: trusted.
        }
      }
      return candidate;
    }
  }
  return undefined;
}

/** A runner that executes the git at `gitPath` (absolute), never a PATH lookup. */
export function gitAt(gitPath: string): GitRunner {
  return (args, opts) =>
    new Promise((resolve) => {
      execFile(gitPath, args, { cwd: opts.cwd, env: opts.env, timeout: 120_000 }, (err, stdout, stderr) => {
        const code = err
          ? typeof (err as { code?: unknown }).code === "number"
            ? (err as { code: number }).code
            : 1
          : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      });
    });
}

export interface PushHeadOptions {
  /** `owner/repo` the PR is for. */
  repo: string;
  /** The PR's head branch. */
  head: string;
  /** The PR's base branch. */
  base: string;
  /**
   * The repo's default branch, from the GitHub API. Without it nothing is
   * pushed: the checkout's `origin/HEAD` is agent-written and not consulted.
   */
  defaultBranch?: string;
  /** The github skill's token. Without it nothing is pushed. */
  token?: string;
  /** The checkout (the run's `cwd`). */
  cwd: string;
  /**
   * The operator's env: `GITHUB_SERVER_URL`, proxy and CA settings. Default:
   * `process.env`, read through the startup snapshot (startup-env.ts), so a
   * value the workspace `.env` introduced is never used. PATH always comes from
   * the startup snapshot.
   */
  env?: NodeJS.ProcessEnv;
  /** Test seam. Default: the git {@link resolveTrustedGit} finds on the startup PATH. */
  git?: GitRunner;
}

export interface PushHeadResult {
  pushed: boolean;
  /** A push ran (and `pushed` says whether it worked); false when a guard skipped it. */
  attempted: boolean;
  /** Why nothing was pushed, or why the push failed. Never carries the token. */
  reason?: string;
}

/** `owner/repo` from a GitHub remote URL (https, ssh or scp form), lowercased, or undefined. */
export function repoFromRemote(url: string): { host: string; repo: string; https: boolean } | undefined {
  const u = url.trim();
  const https = /^https?:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i.exec(u);
  if (https) return { host: https[1].toLowerCase(), repo: https[2].toLowerCase(), https: true };
  const ssh = /^ssh:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i.exec(u);
  if (ssh) return { host: ssh[1].toLowerCase(), repo: ssh[2].toLowerCase(), https: false };
  const scp = /^(?:[^@/]+@)?([^/:]+):(.+?)(?:\.git)?\/?$/.exec(u);
  if (scp) return { host: scp[1].toLowerCase(), repo: scp[2].toLowerCase(), https: false };
  return undefined;
}

/** A branch name sweny will pass to git: plain ref characters, no option or traversal forms. */
export function isSafeBranch(name: string): boolean {
  return (
    /^[A-Za-z0-9._/-]+$/.test(name) &&
    !name.startsWith("-") &&
    !name.startsWith("/") &&
    !name.endsWith("/") &&
    !name.endsWith(".lock") &&
    !name.includes("..") &&
    !name.includes("//")
  );
}

/** `owner/repo` with plain name characters only. */
export function isSafeRepo(repo: string): boolean {
  const parts = repo.split("/");
  return (
    parts.length === 2 &&
    parts.every((p) => /^[A-Za-z0-9._-]+$/.test(p) && p !== "." && p !== ".." && !p.startsWith("-"))
  );
}

/** The command-scope git config that authenticates one push to `server` with `token`. */
export function pushAuthConfig(server: string, token: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  const base = Number.parseInt(out.GIT_CONFIG_COUNT ?? "0", 10);
  let n = Number.isFinite(base) && base > 0 ? base : 0;
  const key = `http.${server.replace(/\/+$/, "")}/.extraheader`;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  // An empty value resets the list, so no other header is sent with it.
  for (const value of ["", `AUTHORIZATION: basic ${basic}`]) {
    out[`GIT_CONFIG_KEY_${n}`] = key;
    out[`GIT_CONFIG_VALUE_${n}`] = value;
    n++;
  }
  out.GIT_CONFIG_COUNT = String(n);
  return out;
}

// What the operator's env may hand git: locale, home, temp dirs, proxies and
// CA bundles, each through the startup snapshot (trustedEnvValue). PATH is set
// by the caller from the trusted startup PATH. Every other GIT_* setting
// (GIT_DIR, GIT_CONFIG_*, GIT_SSH*, GIT_ASKPASS, GIT_TRACE*, ...) is dropped.
const KEPT_ENV =
  /^(HOME|USERPROFILE|TMPDIR|TEMP|TMP|LANG|LANGUAGE|LC_[A-Z_]+|SYSTEMROOT|SystemRoot|COMSPEC|ComSpec|PATHEXT|(HTTPS?|ALL|NO)_PROXY|(https?|all|no)_proxy|SSL_CERT_FILE|SSL_CERT_DIR|GIT_SSL_CAINFO|GIT_SSL_CAPATH)$/;

/**
 * The env every sweny-side git call runs with: the trusted PATH, no system or
 * global config, no prompts, no inherited git settings, and no kept value the
 * workspace `.env` introduced.
 */
export function hardenedGitEnv(env: NodeJS.ProcessEnv, trustedPath?: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  const keys = new Set([...Object.keys(env === process.env ? startupEnv() : env), ...Object.keys(startupEnv())]);
  for (const k of keys) {
    if (!KEPT_ENV.test(k)) continue;
    const v = trustedEnvValue(env, k);
    if (v !== undefined) out[k] = v;
  }
  if (trustedPath !== undefined) out.PATH = trustedPath;
  out.GIT_CONFIG_NOSYSTEM = "1";
  out.GIT_CONFIG_GLOBAL = devNull;
  out.GIT_TERMINAL_PROMPT = "0";
  return out;
}

/** Command-line config (highest precedence) for every sweny-side git call. */
function hardenedArgs(hooksDir: string): string[] {
  return [
    "-c",
    `core.hooksPath=${hooksDir}`,
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.sshCommand=",
    "-c",
    "credential.helper=",
    "-c",
    "core.askPass=",
    "-c",
    "protocol.ext.allow=never",
  ];
}

/** A branch name without a leading `refs/heads/`, so `refs/heads/develop` and `develop` compare equal. */
export function branchName(ref: string): string {
  return ref.trim().replace(/^refs\/heads\//, "");
}

/**
 * Push the PR's head branch from the sweny process. Never throws.
 */
export async function pushHeadBranch(opts: PushHeadOptions): Promise<PushHeadResult> {
  const { token } = opts;
  const head = branchName(opts.head);
  const base = branchName(opts.base);
  const defaultBranch = opts.defaultBranch === undefined ? undefined : branchName(opts.defaultBranch);
  if (!isSafeRepo(opts.repo))
    return { pushed: false, attempted: false, reason: `repo "${opts.repo}" is not owner/repo` };
  if (!isSafeBranch(head))
    return { pushed: false, attempted: false, reason: `head "${head}" is not a plain branch name` };
  if (head === base) return { pushed: false, attempted: false, reason: "head is the base branch" };
  if (!defaultBranch) return { pushed: false, attempted: false, reason: "the repo's default branch is unknown" };
  if (head === defaultBranch || head === "main" || head === "master") {
    return { pushed: false, attempted: false, reason: `head ${head} is the default branch` };
  }
  if (!token) return { pushed: false, attempted: false, reason: "no GITHUB_TOKEN" };

  const opEnv = opts.env ?? process.env;
  const cwd = path.resolve(opts.cwd);
  // git and its PATH come from the startup snapshot, never the run's env or the workspace.
  const startupPath = startupEnv().PATH ?? startupEnv().Path;
  const gitPath = opts.git ? undefined : resolveTrustedGit(startupPath, cwd);
  if (!opts.git && !gitPath) {
    return { pushed: false, attempted: false, reason: "no git outside the workspace and writable dirs" };
  }
  const git: GitRunner = opts.git ?? gitAt(gitPath!);
  let server: URL;
  try {
    server = new URL((trustedEnvValue(opEnv, "GITHUB_SERVER_URL") || "https://github.com").replace(/\/+$/, ""));
  } catch {
    return { pushed: false, attempted: false, reason: "GITHUB_SERVER_URL is not a URL" };
  }
  if (server.protocol !== "https:" || server.username || server.password || server.search || server.hash) {
    return { pushed: false, attempted: false, reason: "GITHUB_SERVER_URL is not a plain https URL" };
  }
  const serverBase = `${server.origin}${server.pathname.replace(/\/+$/, "")}`;
  const serverHost = server.hostname.toLowerCase();
  const destination = `${serverBase}/${opts.repo}.git`;

  const env = hardenedGitEnv(opEnv, trustedPathDirs(startupPath, cwd).join(path.delimiter));
  let tmp: string | undefined;
  try {
    tmp = mkdtempSync(path.join(startupTmpdir(), "sweny-push-"));
    const hooks = path.join(tmp, "hooks");
    mkdirSync(hooks, { mode: 0o700 });
    const hard = hardenedArgs(hooks);
    // Reads in the agent's checkout: no token in the env, nothing run from its config.
    const read = (args: string[]) => git([...hard, "-c", "safe.directory=*", ...args], { cwd, env });

    const local = await read(["rev-parse", "--verify", "--quiet", `refs/heads/${head}^{commit}`]);
    const sha = local.stdout.trim();
    if (local.code !== 0 || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) {
      return { pushed: false, attempted: false, reason: `no local branch ${head}` };
    }
    const fetchUrls = await read(["remote", "get-url", "--all", "origin"]);
    const pushUrls = await read(["remote", "get-url", "--push", "--all", "origin"]);
    if (fetchUrls.code !== 0 || pushUrls.code !== 0) {
      return { pushed: false, attempted: false, reason: "no origin remote" };
    }
    const urls = `${fetchUrls.stdout}\n${pushUrls.stdout}`
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    const wanted = opts.repo.toLowerCase();
    const bad =
      urls.length === 0 ||
      urls.some((u) => {
        const p = repoFromRemote(u);
        return !p || p.repo !== wanted || p.host !== serverHost;
      });
    if (bad) return { pushed: false, attempted: false, reason: `origin is not ${opts.repo} on ${serverHost}` };

    const objectsOut = await read(["rev-parse", "--git-path", "objects"]);
    const shallowOut = await read(["rev-parse", "--git-path", "shallow"]);
    if (objectsOut.code !== 0 || shallowOut.code !== 0) {
      return { pushed: false, attempted: false, reason: "cannot locate the checkout's object store" };
    }
    const objects = path.resolve(cwd, objectsOut.stdout.trim());
    const shallow = path.resolve(cwd, shallowOut.stdout.trim());

    // A private bare repo that borrows the checkout's objects and holds one ref.
    const repoDir = path.join(tmp, "push.git");
    const own = (args: string[], extraEnv?: NodeJS.ProcessEnv) =>
      git([...hard, `--git-dir=${repoDir}`, ...args], { cwd: tmp!, env: { ...env, ...extraEnv } });
    const init = await git([...hard, "init", "--quiet", "--bare", repoDir], { cwd: tmp, env });
    if (init.code !== 0) return { pushed: false, attempted: false, reason: "cannot create the push repo" };
    writeFileSync(path.join(repoDir, "objects", "info", "alternates"), `${objects}\n`);
    // A shallow checkout (actions/checkout's default): copy its boundary list. Only a
    // plain, bounded file; a link or FIFO the agent planted is not read.
    const shallowStat = lstatSync(shallow, { throwIfNoEntry: false });
    if (shallowStat?.isFile() && shallowStat.size <= 1 << 20) {
      writeFileSync(path.join(repoDir, "shallow"), readFileSync(shallow));
    }
    const ref = await own(["update-ref", `refs/heads/${head}`, sha]);
    if (ref.code !== 0) return { pushed: false, attempted: false, reason: `cannot stage ${head} for the push` };

    const r = await own(
      ["push", "--no-verify", "--porcelain", destination, `refs/heads/${head}:refs/heads/${head}`],
      pushAuthConfig(serverBase, token, {}),
    );
    if (r.code !== 0) {
      const why = (r.stderr || r.stdout).trim().split("\n").at(-1) ?? "";
      return { pushed: false, attempted: true, reason: `git push failed: ${redact(why, token)}` };
    }
    return { pushed: true, attempted: true };
  } catch (err) {
    return {
      pushed: false,
      attempted: false,
      reason: redact(err instanceof Error ? err.message : String(err), token),
    };
  } finally {
    if (tmp) {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // Best effort: a leftover temp dir holds no secret.
      }
    }
  }
}

function redact(text: string, token: string | undefined): string {
  if (!token) return text;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return text.split(token).join("***").split(basic).join("***");
}

/** A pusher bound to one run's checkout and env (handed to tools as `ToolContext.pushBranch`). */
export function bindBranchPusher(cwd: string, env?: NodeJS.ProcessEnv): BranchPusher {
  return (o) => pushHeadBranch({ ...o, cwd, env });
}
