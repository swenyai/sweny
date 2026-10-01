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
 * Guard rails: only a local branch that exists, only when origin is the PR's
 * own repo, never force, never the base branch or the remote's default branch.
 * A push that fails is logged and the PR is still requested: the agent may
 * already have pushed (persisted credentials, an `agent_env` grant).
 */

import { execFile } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";
import type { BranchPusher } from "../types.js";

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<GitRunResult>;

const defaultGit: GitRunner = (args, opts) =>
  new Promise((resolve) => {
    execFile("git", args, { cwd: opts.cwd, env: opts.env, timeout: 120_000 }, (err, stdout, stderr) => {
      const code = err
        ? typeof (err as { code?: unknown }).code === "number"
          ? (err as { code: number }).code
          : 1
        : 0;
      resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });

export interface PushHeadOptions {
  /** `owner/repo` the PR is for. */
  repo: string;
  /** The PR's head branch. */
  head: string;
  /** The PR's base branch. */
  base: string;
  /** The github skill's token. Without it nothing is pushed. */
  token?: string;
  /** The checkout (the run's `cwd`). */
  cwd: string;
  /** The operator's env: `GITHUB_SERVER_URL`, proxy and CA settings. Default: `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Test seam. */
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

// What the operator's env may hand git: the path, locale, temp dirs, proxies
// and CA bundles. Every other GIT_* setting (GIT_DIR, GIT_CONFIG_*, GIT_SSH*,
// GIT_ASKPASS, GIT_TRACE*, ...) is dropped.
const KEPT_ENV =
  /^(PATH|Path|HOME|USERPROFILE|TMPDIR|TEMP|TMP|LANG|LANGUAGE|LC_[A-Z_]+|SYSTEMROOT|SystemRoot|COMSPEC|ComSpec|PATHEXT|(HTTPS?|ALL|NO)_PROXY|(https?|all|no)_proxy|SSL_CERT_FILE|SSL_CERT_DIR|GIT_SSL_CAINFO|GIT_SSL_CAPATH)$/;

/** The env every sweny-side git call runs with: no system or global config, no prompts, no inherited git settings. */
export function hardenedGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && KEPT_ENV.test(k)) out[k] = v;
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

/**
 * Push the PR's head branch from the sweny process. Never throws.
 */
export async function pushHeadBranch(opts: PushHeadOptions): Promise<PushHeadResult> {
  const git = opts.git ?? defaultGit;
  const { head, base, token } = opts;
  if (!isSafeRepo(opts.repo))
    return { pushed: false, attempted: false, reason: `repo "${opts.repo}" is not owner/repo` };
  if (!isSafeBranch(head))
    return { pushed: false, attempted: false, reason: `head "${head}" is not a plain branch name` };
  if (head === base) return { pushed: false, attempted: false, reason: "head is the base branch" };
  if (!token) return { pushed: false, attempted: false, reason: "no GITHUB_TOKEN" };

  const opEnv = opts.env ?? process.env;
  let server: URL;
  try {
    server = new URL((opEnv.GITHUB_SERVER_URL || "https://github.com").replace(/\/+$/, ""));
  } catch {
    return { pushed: false, attempted: false, reason: "GITHUB_SERVER_URL is not a URL" };
  }
  if (server.protocol !== "https:" || server.username || server.password || server.search || server.hash) {
    return { pushed: false, attempted: false, reason: "GITHUB_SERVER_URL is not a plain https URL" };
  }
  const serverBase = `${server.origin}${server.pathname.replace(/\/+$/, "")}`;
  const serverHost = server.hostname.toLowerCase();
  const destination = `${serverBase}/${opts.repo}.git`;

  const cwd = path.resolve(opts.cwd);
  const env = hardenedGitEnv(opEnv);
  let tmp: string | undefined;
  try {
    tmp = mkdtempSync(path.join(tmpdir(), "sweny-push-"));
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

    const originHead = await read(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
    const defaultBranch = originHead.code === 0 ? originHead.stdout.trim().replace(/^origin\//, "") : undefined;
    if (head === defaultBranch || head === "main" || head === "master") {
      return { pushed: false, attempted: false, reason: `head ${head} is the default branch` };
    }

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
