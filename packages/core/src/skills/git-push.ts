/**
 * sweny-side branch push for `github_create_pr` (#473).
 *
 * With `actions/checkout`'s recommended `persist-credentials: false` the
 * checkout holds no token, so the agent's own `git push` in the create_pr node
 * has nothing to push with. sweny pushes the PR's head branch itself, from
 * the sweny process, with the github skill's token (`GITHUB_TOKEN`), right
 * before it opens the PR. The agent never holds the token.
 *
 * Guard rails: only a local branch that exists, only to `origin` when it is
 * the PR's own repo, never force, never the base branch or the remote's
 * default branch. The token goes to git through command-scope config in the
 * child env (`GIT_CONFIG_*`), never argv, as an `http.<server>/.extraheader`
 * that first resets any persisted one (so the job token is never sent twice).
 * A push that fails is logged and the PR is still requested: the agent may
 * already have pushed (persisted credentials, an `agent_env` grant).
 */

import { execFile } from "node:child_process";
import { setBranchPusher } from "./github.js";

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
  /** The github skill's token. Without it, git uses whatever credential the checkout has. */
  token?: string;
  /** The checkout. Default: `process.cwd()`. */
  cwd?: string;
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

/** The command-scope git config that authenticates one push to `server` with `token`. */
export function pushAuthConfig(server: string, token: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  const base = Number.parseInt(out.GIT_CONFIG_COUNT ?? "0", 10);
  let n = Number.isFinite(base) && base > 0 ? base : 0;
  const key = `http.${server.replace(/\/+$/, "")}/.extraheader`;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  // An empty value resets the list, so a header the checkout persisted is not sent too.
  for (const value of ["", `AUTHORIZATION: basic ${basic}`]) {
    out[`GIT_CONFIG_KEY_${n}`] = key;
    out[`GIT_CONFIG_VALUE_${n}`] = value;
    n++;
  }
  out.GIT_CONFIG_COUNT = String(n);
  return out;
}

/**
 * Push the PR's head branch to `origin` from the sweny process. Never throws.
 */
export async function pushHeadBranch(opts: PushHeadOptions): Promise<PushHeadResult> {
  const git = opts.git ?? defaultGit;
  const cwd = opts.cwd ?? process.cwd();
  const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env), GIT_TERMINAL_PROMPT: "0" };
  const { head, base } = opts;
  if (!isSafeBranch(head))
    return { pushed: false, attempted: false, reason: `head "${head}" is not a plain branch name` };
  if (head === base) return { pushed: false, attempted: false, reason: "head is the base branch" };
  try {
    const local = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${head}^{commit}`], { cwd, env });
    if (local.code !== 0) return { pushed: false, attempted: false, reason: `no local branch ${head}` };
    const remote = await git(["remote", "get-url", "origin"], { cwd, env });
    if (remote.code !== 0) return { pushed: false, attempted: false, reason: "no origin remote" };
    const parsed = repoFromRemote(remote.stdout);
    if (!parsed || parsed.repo !== opts.repo.toLowerCase()) {
      return { pushed: false, attempted: false, reason: `origin is not ${opts.repo}` };
    }
    const originHead = await git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { cwd, env });
    const defaultBranch = originHead.code === 0 ? originHead.stdout.trim().replace(/^origin\//, "") : undefined;
    if (head === defaultBranch || head === "main" || head === "master") {
      return { pushed: false, attempted: false, reason: `head ${head} is the default branch` };
    }
    const server = (env.GITHUB_SERVER_URL || "https://github.com").replace(/\/+$/, "");
    let serverHost: string;
    try {
      serverHost = new URL(server).host.toLowerCase();
    } catch {
      serverHost = "github.com";
    }
    const pushEnv =
      opts.token && parsed.https && parsed.host === serverHost ? pushAuthConfig(server, opts.token, env) : env;
    const r = await git(["push", "--porcelain", "origin", `refs/heads/${head}:refs/heads/${head}`], {
      cwd,
      env: pushEnv,
    });
    if (r.code !== 0) {
      const why = (r.stderr || r.stdout).trim().split("\n").at(-1) ?? "";
      return { pushed: false, attempted: true, reason: `git push failed: ${redact(why, opts.token)}` };
    }
    return { pushed: true, attempted: true };
  } catch (err) {
    return {
      pushed: false,
      attempted: false,
      reason: redact(err instanceof Error ? err.message : String(err), opts.token),
    };
  }
}

function redact(text: string, token: string | undefined): string {
  if (!token) return text;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return text.split(token).join("***").split(basic).join("***");
}

// The Node entry imports this module (executor.ts), which arms the push in `github_create_pr`.
setBranchPusher(pushHeadBranch);
