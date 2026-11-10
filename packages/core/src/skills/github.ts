/**
 * GitHub Skill
 *
 * Replaces: source-control/github.ts + issue-tracking/github-issues.ts
 * ~800 lines → ~120 lines
 */

import type { BranchPusher, Skill, ToolContext, SkillCategory, ToolRefusal } from "../types.js";
import {
  PR_COMMENT_SKIP_REASON,
  isRunPullRequest,
  prCommentSummaryLine,
  upsertPrComment,
  type CommentAuthor,
} from "../pr-comment.js";

// #473: the sweny-side head-branch push arrives as `ctx.pushBranch`, bound to
// the run's checkout by the Node executor (skills/git-push.ts). This module
// stays browser-safe; without a pusher `github_create_pr` only calls the API.
export type { BranchPusher } from "../types.js";

class GitHubApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`[GitHub] API request failed (HTTP ${status}): ${body}`);
    this.name = "GitHubApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * The REST base: `ctx.githubApiUrl` (the operator's GITHUB_API_URL, for GHES)
 * or https://api.github.com. Only a plain https URL: no credentials, query or
 * fragment, since the token goes to it.
 */
export function githubApiBase(apiUrl: string | undefined): string {
  if (!apiUrl) return "https://api.github.com";
  let u: URL;
  try {
    u = new URL(apiUrl);
  } catch {
    throw new Error(`[GitHub] GITHUB_API_URL is not a URL`);
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) {
    throw new Error(`[GitHub] GITHUB_API_URL is not a plain https URL`);
  }
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

async function gh(path: string, ctx: ToolContext, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${githubApiBase(ctx.githubApiUrl)}${path}`, {
    ...init,
    headers: {
      Authorization: `token ${ctx.config.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new GitHubApiError(res.status, await res.text());
  return res.json();
}

/**
 * Hard caps for `github_get_pr_patches`: the agent names the files, the tool
 * decides how much of them it gets. A reviewer's evidence, not the whole diff.
 */
export const PR_PATCH_CAPS = { maxFiles: 8, maxBytesPerFile: 6000, maxTotalBytes: 24000 } as const;

/** The PR files endpoint lists at most 3000 files, 100 a page. */
const PR_FILES_MAX_PAGES = 30;

export interface PrPatchHunk {
  /** The hunk header alone, e.g. `@@ -10,6 +10,9 @@`. */
  header: string;
  /** New-file line range the hunk covers (`start` = `end` = the old position for a pure deletion). */
  new_start: number;
  new_end: number;
  /** The hunk body (context, `+` and `-` lines), header line included. */
  text: string;
  /** True when the byte cap cut this hunk short. */
  cut?: boolean;
}

export interface PrPatchSelection {
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    hunks: PrPatchHunk[];
    /** True when the byte caps dropped or cut any of this file's hunks. */
    truncated: boolean;
    hunks_omitted: number;
  }>;
  omitted: Array<{ filename: string; reason: string }>;
  /** True when anything requested was left out or cut. */
  truncated: boolean;
  bytes: number;
  caps: typeof PR_PATCH_CAPS;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Split a GitHub file patch into hunks at each `@@` header. */
export function splitHunks(patch: string): PrPatchHunk[] {
  const hunks: PrPatchHunk[] = [];
  let cur: PrPatchHunk | null = null;
  for (const line of patch.split("\n")) {
    const m = HUNK_HEADER.exec(line);
    if (m) {
      const start = Number(m[3]);
      const len = m[4] === undefined ? 1 : Number(m[4]);
      cur = { header: m[0], new_start: start, new_end: len > 0 ? start + len - 1 : start, text: line };
      hunks.push(cur);
    } else if (cur) {
      cur.text += `\n${line}`;
    }
  }
  return hunks;
}

const utf8 = new TextEncoder();
const byteLength = (s: string) => utf8.encode(s).length;

/** The longest prefix of `s` that fits in `max` UTF-8 bytes, never splitting a character. */
function cutToBytes(s: string, max: number): string {
  let out = "";
  let used = 0;
  for (const ch of s) {
    const n = byteLength(ch);
    if (used + n > max) break;
    out += ch;
    used += n;
  }
  return out;
}

/**
 * Apply {@link PR_PATCH_CAPS} to the requested files, in the order asked.
 * Pure: `found` is the PR's file records by filename (GitHub's `patch` is
 * absent for binary files and for diffs too large for the API).
 */
export function selectPrPatches(wanted: string[], found: Map<string, Record<string, unknown>>): PrPatchSelection {
  const caps = PR_PATCH_CAPS;
  const out: PrPatchSelection = { files: [], omitted: [], truncated: false, bytes: 0, caps };
  for (const filename of wanted) {
    const f = found.get(filename);
    if (!f) {
      out.omitted.push({ filename, reason: "not a changed file in this pull request" });
      continue;
    }
    if (typeof f.patch !== "string" || f.patch.length === 0) {
      out.omitted.push({ filename, reason: "no patch from GitHub (binary file, or a diff too large for the API)" });
      continue;
    }
    if (out.files.length >= caps.maxFiles) {
      out.omitted.push({ filename, reason: `file cap (${caps.maxFiles} files)` });
      continue;
    }
    const left = caps.maxTotalBytes - out.bytes;
    if (left <= 0) {
      out.omitted.push({ filename, reason: `byte budget spent (${caps.maxTotalBytes} bytes in all)` });
      continue;
    }
    const budget = Math.min(caps.maxBytesPerFile, left);
    const all = splitHunks(f.patch);
    const hunks: PrPatchHunk[] = [];
    let used = 0;
    for (const h of all) {
      const n = byteLength(h.text);
      if (used + n <= budget) {
        hunks.push(h);
        used += n;
        continue;
      }
      // The first hunk that does not fit: keep its head when nothing of this
      // file fits yet, so a large single-hunk file still shows its start.
      if (hunks.length === 0) {
        const text = cutToBytes(h.text, budget);
        hunks.push({ ...h, text, cut: true });
        used += byteLength(text);
      }
      break;
    }
    const dropped = all.length - hunks.length;
    const truncated = dropped > 0 || hunks.some((h) => h.cut);
    out.files.push({
      filename,
      status: String(f.status ?? ""),
      additions: Number(f.additions ?? 0),
      deletions: Number(f.deletions ?? 0),
      hunks,
      truncated,
      hunks_omitted: dropped,
    });
    out.bytes += used;
    if (truncated) out.truncated = true;
  }
  if (out.omitted.length > 0) out.truncated = true;
  return out;
}

/** The GraphQL endpoint beside the REST base: `/api/graphql` on GHES, `/graphql` on github.com. */
export function githubGraphqlUrl(apiUrl: string | undefined): string {
  const base = githubApiBase(apiUrl);
  return /\/api\/v3$/.test(base) ? base.replace(/\/api\/v3$/, "/api/graphql") : `${base}/graphql`;
}

/**
 * The account this token posts as (#536). A PAT or OAuth token: `GET /user`.
 * An installation token (the Actions `github.token`, a GitHub App) gets 403
 * there, so ask GraphQL's `viewer`. Probed live on Actions (2026-11-07): the
 * job token answers `{ login: "github-actions[bot]", __typename: "User" }`,
 * so a "[bot]" suffix (which a user login cannot contain) or a `Bot` typename
 * means a bot, shown by REST as `<name>[bot]` with type `Bot`; anything else
 * is a user (a PAT whose `/user` read failed once). An HTTP error, a GraphQL
 * `errors` array or an odd login leaves the account unknown.
 */
export async function resolveCommentAuthor(ctx: ToolContext): Promise<CommentAuthor | undefined> {
  try {
    const user = (await gh("/user", ctx)) as { login?: unknown; type?: unknown } | null;
    if (typeof user?.login === "string" && user.login) {
      return { login: user.login, type: user.type === "Bot" ? "Bot" : "User" };
    }
  } catch {
    // An installation token cannot read /user; ask GraphQL.
  }
  try {
    const res = await fetch(githubGraphqlUrl(ctx.githubApiUrl), {
      method: "POST",
      headers: { Authorization: `bearer ${ctx.config.GITHUB_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query { viewer { login __typename } }" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      data?: { viewer?: { login?: unknown; __typename?: unknown } | null } | null;
      errors?: unknown;
    } | null;
    if (json?.errors !== undefined && json?.errors !== null) return undefined;
    const login = json?.data?.viewer?.login;
    const kind = json?.data?.viewer?.__typename;
    if (typeof login !== "string" || !/^[A-Za-z0-9-]+(\[bot\])?$/.test(login)) return undefined;
    if (login.endsWith("[bot]") || kind === "Bot") {
      return { login: `${login.replace(/\[bot\]$/, "")}[bot]`, type: "Bot" };
    }
    if (kind === "User") return { login, type: "User" };
  } catch {
    // Unknown account: handled by upsertPrComment.
  }
  return undefined;
}

/** One lookup per run: the run context object is the same for every tool call in a run. */
const commentAuthors = new WeakMap<object, Promise<CommentAuthor | undefined>>();

function commentAuthorFor(ctx: ToolContext, run: object): Promise<CommentAuthor | undefined> {
  let author = commentAuthors.get(run);
  if (!author) {
    author = resolveCommentAuthor(ctx);
    commentAuthors.set(run, author);
  }
  return author;
}

/**
 * Whether sweny may push the PR's head branch, from the API (#498). The agent
 * names head and base, so head could be an existing integration branch
 * ("release") that is neither base nor default. A head that does not exist
 * remotely is pushed with an empty lease (it must still not exist). One that
 * exists is pushed only when it is unprotected and already has an open PR from
 * this repo into `base`, leased on the sha the API returned. Any API failure
 * means no push. A skip carries the remote head sha when the API returned one.
 */
export async function headPushLease(
  repo: string,
  head: string,
  base: string,
  ctx: ToolContext,
): Promise<{ remoteSha: string } | { skip: string; remoteSha?: string }> {
  const branch = head.replace(/^refs\/heads\//, "");
  const target = base.replace(/^refs\/heads\//, "");
  const seg = branch.split("/").map(encodeURIComponent).join("/");
  let info: { protected?: unknown; commit?: { sha?: unknown } };
  try {
    info = (await gh(`/repos/${repo}/branches/${seg}`, ctx)) as typeof info;
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) return { remoteSha: "" };
    return { skip: `cannot check head ${branch} on ${repo}: ${err instanceof Error ? err.message : String(err)}` };
  }
  const sha = info?.commit?.sha;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) {
    return { skip: `cannot check head ${branch} on ${repo}: no branch sha in the API answer` };
  }
  if (info.protected !== false) return { skip: `head ${branch} exists on ${repo} and is protected`, remoteSha: sha };
  const owner = repo.split("/")[0];
  let open: unknown;
  try {
    open = await gh(
      `/repos/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&base=${encodeURIComponent(target)}&state=open&per_page=1`,
      ctx,
    );
  } catch (err) {
    return {
      skip: `cannot check open PRs for ${branch} on ${repo}: ${err instanceof Error ? err.message : String(err)}`,
      remoteSha: sha,
    };
  }
  if (!Array.isArray(open) || open.length === 0) {
    return { skip: `head ${branch} already exists on ${repo} with no open PR into ${target}`, remoteSha: sha };
  }
  return { remoteSha: sha };
}

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

// Fixed-wording refusal reasons for `github_create_pr` (#544). Receipts and PR
// comments carry these; shas and upstream errors go in the result's `detail`.
const REFUSE_NO_LOCAL = "the head push failed and the pusher did not report the local commit";
const REFUSE_UNREADABLE = "the head push failed and the remote head could not be read";
const REFUSE_MISMATCH = "the head push failed and the remote head is not the commit this run produced";
const REFUSE_PR_MISMATCH = "the PR was opened but its head is not the commit this run produced";
// #558: the paths where sweny did not push, or pushed without naming the commit.
const REFUSE_SKIP_UNREADABLE = "the head branch was not pushed and the remote head could not be read";
const REFUSE_SKIP_MISMATCH = "the head branch was not pushed and the remote head is not the commit this run produced";
const REFUSE_NO_COMMIT = "the run has no local commit for the head branch";
const REFUSE_PUSHED_NO_LOCAL = "the head was pushed but the pusher did not report the local commit";
// #558: the 422 recovery reuses only an open PR into the requested base.
const REFUSE_REUSE_NOT_OPEN = "a PR for this head already exists and is not open";
const REFUSE_REUSE_OTHER_BASE = "a PR for this head already exists into another base branch";
const REFUSE_PR_UNVERIFIED = "the PR was opened but its head commit could not be verified";

/**
 * The sha the remote `head` branch points at, read through the API (#544), or
 * an error. A missing branch is `{ sha: null }`; anything unreadable is an error,
 * so the caller fails closed.
 */
async function remoteHeadSha(
  repo: string,
  head: string,
  ctx: ToolContext,
): Promise<{ sha: string | null } | { error: string }> {
  const branch = head.replace(/^refs\/heads\//, "");
  const seg = branch.split("/").map(encodeURIComponent).join("/");
  let ref: { ref?: unknown; object?: { sha?: unknown } };
  try {
    ref = (await gh(`/repos/${repo}/git/ref/heads/${seg}`, ctx)) as typeof ref;
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) return { sha: null };
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const sha = ref?.object?.sha;
  if (ref?.ref !== `refs/heads/${branch}` || typeof sha !== "string" || !SHA.test(sha)) {
    return { error: "no matching ref in the API answer" };
  }
  return { sha };
}

function isAlreadyExistsError(err: unknown): err is GitHubApiError {
  if (!(err instanceof GitHubApiError) || err.status !== 422) return false;
  return /pull request already exists/i.test(err.body);
}

/**
 * Encode an LLM-chosen repo file path for safe interpolation into a
 * GitHub API request path.
 *
 * Trust model (issue #226): tool arguments are runtime-controlled by the
 * model and can be steered by prompt-injected content. Without encoding,
 * a `path` containing `?` or `#` rewrites the request (injects query
 * params / truncates via fragment), and `..` segments walk out of the
 * `/contents/` endpoint entirely.
 *
 * Each `/`-separated segment is percent-encoded (so `/` between segments
 * is preserved); `.` and `..` segments are rejected outright because
 * URL normalization resolves them server-side even when encoded.
 */
export function encodeRepoFilePath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => {
      if (segment === "." || segment === "..") {
        throw new Error(`[GitHub] Invalid path segment "${segment}" — relative path segments are not allowed`);
      }
      return encodeURIComponent(segment);
    })
    .join("/");
}

export const github: Skill = {
  id: "github",
  name: "GitHub",
  description: "Search code, manage issues and pull requests on GitHub",
  category: "git",
  config: {
    GITHUB_TOKEN: {
      description: "GitHub personal access token or app installation token",
      required: true,
      env: "GITHUB_TOKEN",
    },
  },
  tools: [
    {
      name: "github_search_code",
      access: "read",
      description: "Search for code in a GitHub repository",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (GitHub code search syntax)" },
          repo: { type: "string", description: "Repository in owner/repo format" },
        },
        required: ["query", "repo"],
      },
      handler: async (input: { query: string; repo: string }, ctx) =>
        gh(`/search/code?q=${encodeURIComponent(`${input.query} repo:${input.repo}`)}&per_page=20`, ctx),
    },
    {
      name: "github_get_issue",
      access: "read",
      description: "Get details of a GitHub issue",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo" },
          number: { type: "number", description: "Issue number" },
        },
        required: ["repo", "number"],
      },
      handler: async (input: { repo: string; number: number }, ctx) =>
        gh(`/repos/${input.repo}/issues/${input.number}`, ctx),
    },
    {
      name: "github_search_issues",
      access: "read",
      description: "Search issues and pull requests",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (GitHub issues search syntax)" },
          repo: { type: "string", description: "owner/repo — optional, scope to a repo" },
        },
        required: ["query"],
      },
      handler: async (input: { query: string; repo?: string }, ctx) => {
        const q = input.repo ? `${input.query} repo:${input.repo}` : input.query;
        return gh(`/search/issues?q=${encodeURIComponent(q)}&per_page=20`, ctx);
      },
    },
    {
      name: "github_list_issues",
      access: "read",
      description: "List a repository's most recently created issues (open and closed), newest first",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo" },
          per_page: { type: "number", description: "How many per page (max 100, default 30)" },
          page: { type: "number", description: "Page number, from 1 (default 1)" },
        },
        required: ["repo"],
      },
      handler: async (input: { repo: string; per_page?: number; page?: number }, ctx) => {
        const n = Math.min(100, Math.max(1, Math.floor(input.per_page ?? 30)));
        const page = Math.max(1, Math.floor(input.page ?? 1));
        return gh(`/repos/${input.repo}/issues?state=all&sort=created&direction=desc&per_page=${n}&page=${page}`, ctx);
      },
    },
    {
      name: "github_list_issue_comments",
      access: "read",
      description: "List comments on an issue or pull request, optionally only those updated since a time",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo" },
          issue_number: { type: "number", description: "Issue or PR number" },
          since: { type: "string", description: "ISO 8601 time: only comments updated at or after it" },
          page: { type: "number", description: "Page of 100 comments, oldest first, from 1 (default 1)" },
        },
        required: ["repo", "issue_number"],
      },
      handler: async (input: { repo: string; issue_number: number; since?: string; page?: number }, ctx) => {
        const since = input.since ? `&since=${encodeURIComponent(input.since)}` : "";
        const page = Math.max(1, Math.floor(input.page ?? 1));
        return gh(
          `/repos/${input.repo}/issues/${Number(input.issue_number)}/comments?per_page=100&page=${page}${since}`,
          ctx,
        );
      },
    },
    {
      name: "github_create_issue",
      access: "write",
      description: "Create a new GitHub issue",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo" },
          title: { type: "string" },
          body: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
        },
        required: ["repo", "title"],
      },
      handler: async (input: { repo: string; title: string; body?: string; labels?: string[] }, ctx) =>
        gh(`/repos/${input.repo}/issues`, ctx, {
          method: "POST",
          body: JSON.stringify({ title: input.title, body: input.body, labels: input.labels }),
        }),
    },
    {
      name: "github_add_comment",
      access: "write",
      description: "Add a comment to a GitHub issue or pull request",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo" },
          issue_number: { type: "number", description: "Issue or PR number" },
          body: { type: "string", description: "Comment body (markdown)" },
        },
        required: ["repo", "issue_number", "body"],
      },
      handler: async (input: { repo: string; issue_number: number; body: string }, ctx) => {
        // #536: on the run's own PR (identified by the runtime, not the input), one
        // marked comment per workflow, updated in place; nothing written when the
        // findings are empty or unchanged. Every other target appends as before.
        if (ctx.run && isRunPullRequest(ctx.run, input.repo, Number(input.issue_number))) {
          const result = await upsertPrComment(
            { repo: input.repo, number: Number(input.issue_number), body: String(input.body ?? "") },
            ctx.run,
            (path, init) => gh(path, ctx, init),
            () => commentAuthorFor(ctx, ctx.run!),
          );
          ctx.summary?.(prCommentSummaryLine(ctx.run, result));
          const skipped = PR_COMMENT_SKIP_REASON[result.outcome];
          return {
            ...(result.id !== undefined ? { id: result.id } : {}),
            ...(result.html_url ? { html_url: result.html_url } : {}),
            ...(skipped ? { skipped } : {}),
          };
        }
        return gh(`/repos/${input.repo}/issues/${input.issue_number}/comments`, ctx, {
          method: "POST",
          body: JSON.stringify({ body: input.body }),
        });
      },
    },
    {
      name: "github_create_pr",
      access: "write",
      description: "Create a pull request",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo" },
          title: { type: "string" },
          body: { type: "string" },
          head: { type: "string", description: "Branch with changes" },
          base: { type: "string", description: "Target branch (default: main)" },
          labels: {
            type: "array",
            items: { type: "string" },
            description: 'Labels to apply (default: ["sweny", "agent"])',
          },
        },
        required: ["repo", "title", "head"],
      },
      handler: async (
        input: { repo: string; title: string; body?: string; head: string; base?: string; labels?: string[] },
        ctx,
      ) => {
        let pr: { number?: number; html_url?: string } & Record<string, unknown>;
        let reused = false;
        // The remote head this run saw, for the result (#544).
        let observedHead: string | undefined;
        // With a checkout, the PR's head must be this run's local commit (#544, #558).
        let mustHead: string | undefined;
        // #473: push the head branch from sweny with this skill's token, so the
        // recommended `persist-credentials: false` checkout still ships the
        // branch and the agent never holds a write token. Skipped unless the
        // branch exists locally and origin is this repo; never forced.
        if (ctx.pushBranch) {
          // The default branch comes from the API, not the agent-written
          // checkout's origin/HEAD. Unknown means no push.
          let defaultBranch: string | undefined;
          try {
            const meta = (await gh(`/repos/${input.repo}`, ctx)) as { default_branch?: unknown };
            if (typeof meta?.default_branch === "string") defaultBranch = meta.default_branch;
          } catch {
            // The pusher refuses without it; the PR request below reports the API error.
          }
          const lease = await headPushLease(input.repo, input.head, input.base ?? "main", ctx);
          // #558: on a lease skip the pusher is still asked for the local
          // commit, with no lease and no token, so it cannot push.
          const push: Awaited<ReturnType<BranchPusher>> = await ctx.pushBranch({
            repo: input.repo,
            head: input.head,
            base: input.base ?? "main",
            ...(defaultBranch ? { defaultBranch } : {}),
            ...("skip" in lease ? {} : { remoteSha: lease.remoteSha, token: ctx.config.GITHUB_TOKEN }),
          });
          if (lease.remoteSha) observedHead = lease.remoteSha;
          const notPushed = "skip" in lease ? lease.skip : push.reason;
          if ("skip" in lease) ctx.logger?.warn?.(`  github_create_pr: not pushing: ${lease.skip}`);
          else if (push.pushed) ctx.logger?.info?.(`  github_create_pr: pushed ${input.head} to ${input.repo}`);
          else if (push.attempted) ctx.logger?.warn?.(`  github_create_pr: ${push.reason}`);
          else ctx.logger?.debug?.(`  github_create_pr: no sweny-side push (${push.reason})`);
          const local = typeof push.sha === "string" && SHA.test(push.sha) ? push.sha : null;
          const failed = !push.pushed && push.attempted;
          const refuse = (reason: string, detail: string, remoteSha: string | null, transient = false) => {
            ctx.logger?.warn?.(`  github_create_pr: refusing to open the PR: ${detail}`);
            const refusal: ToolRefusal & Record<string, unknown> = {
              refused: true,
              reason,
              detail,
              // A ref read that failed may succeed later; nothing was written.
              ...(transient ? { transient: true } : {}),
              head: input.head,
              local_sha: local,
              remote_sha: remoteSha,
            };
            return refusal;
          };
          if (!local) {
            // #558: no local commit for the head. Nothing ties the remote branch
            // (the agent named it) to this run, so no PR. A failed push keeps #544's wording.
            if (push.pushed) {
              return refuse(
                REFUSE_PUSHED_NO_LOCAL,
                `sweny pushed ${input.head} but did not get the local commit`,
                null,
              );
            }
            return failed
              ? refuse(
                  REFUSE_NO_LOCAL,
                  `sweny's push failed (${push.reason}) and the pusher did not report the local commit`,
                  null,
                )
              : refuse(
                  REFUSE_NO_COMMIT,
                  `sweny did not push (${notPushed}) and the checkout has no commit for ${input.head}`,
                  lease.remoteSha || null,
                );
          }
          if (!push.pushed) {
            // #544, #558: sweny did not push, or its push failed. The PR would
            // publish whatever the remote branch holds, so open it only when that
            // is this run's local commit. Anything else, or a remote head that
            // cannot be read, refuses.
            const remote = await remoteHeadSha(input.repo, input.head, ctx);
            const remoteSha = "sha" in remote ? remote.sha : null;
            const lead = failed ? `sweny's push failed (${push.reason})` : `sweny did not push (${notPushed})`;
            if ("error" in remote) {
              return refuse(
                failed ? REFUSE_UNREADABLE : REFUSE_SKIP_UNREADABLE,
                `${lead} and cannot read the remote head of ${input.head}: ${remote.error}`,
                null,
                true,
              );
            }
            if (remoteSha !== local) {
              const why = remoteSha
                ? `the remote head of ${input.head} is ${remoteSha}, not the local commit ${local}`
                : `${input.head} does not exist on ${input.repo}; the local commit is ${local}`;
              return refuse(failed ? REFUSE_MISMATCH : REFUSE_SKIP_MISMATCH, `${lead} and ${why}`, remoteSha);
            }
            ctx.logger?.info?.(
              `  github_create_pr: the remote head is already the local commit ${local}, requesting the PR`,
            );
          }
          observedHead = local;
          mustHead = local;
        }
        try {
          pr = (await gh(`/repos/${input.repo}/pulls`, ctx, {
            method: "POST",
            body: JSON.stringify({
              title: input.title,
              body: input.body,
              head: input.head,
              base: input.base ?? "main",
            }),
          })) as { number?: number; html_url?: string };
        } catch (err) {
          // Recovery: GitHub rejects POST /pulls with 422 when an open PR
          // already exists for the same head branch. Look up that PR and
          // return it as if newly created. Without this the workflow's
          // create_pr eval (`github_create_pr` must succeed) cannot pass
          // on a re-run, and the agent will close the existing PR to
          // satisfy the eval — observed in production as a self-close-
          // and-recreate loop on the same branch.
          if (!isAlreadyExistsError(err)) throw err;
          // #558: reuse only an open PR from this head into the requested base.
          // Anything else that exists for the head (closed, merged, or into
          // another base) is named in a refusal, never returned as reused.
          const owner = input.repo.split("/")[0];
          const headQ = encodeURIComponent(`${owner}:${input.head}`);
          const target = (input.base ?? "main").replace(/^refs\/heads\//, "");
          type Listed = {
            number?: number;
            html_url?: string;
            state?: unknown;
            merged_at?: unknown;
            base?: { ref?: unknown };
          };
          const open = (await gh(
            `/repos/${input.repo}/pulls?head=${headQ}&base=${encodeURIComponent(target)}&state=open&per_page=1`,
            ctx,
          )) as Listed[];
          const existing =
            (Array.isArray(open) ? open[0] : undefined) ??
            ((await gh(`/repos/${input.repo}/pulls?head=${headQ}&state=all&per_page=1`, ctx)) as Listed[])[0];
          if (!existing) throw err;
          const prState = typeof existing.state === "string" ? existing.state : null;
          const prBase = typeof existing.base?.ref === "string" ? existing.base.ref : null;
          if (prState !== "open" || prBase !== target) {
            const merged = typeof existing.merged_at === "string" && existing.merged_at.length > 0;
            const priorHead = (existing as { head?: { sha?: unknown } }).head?.sha;
            const name = existing.html_url ?? `#${existing.number}`;
            const detail =
              `GitHub has a PR for ${input.head} already (${name}), ${merged ? "merged" : (prState ?? "in an unknown state")} ` +
              `into ${prBase ?? "an unknown base"}; sweny reuses only an open PR into ${target}`;
            ctx.logger?.warn?.(`  github_create_pr: not reusing ${name}: ${detail}`);
            const refusal: ToolRefusal & Record<string, unknown> = {
              refused: true,
              reason: prState !== "open" ? REFUSE_REUSE_NOT_OPEN : REFUSE_REUSE_OTHER_BASE,
              detail,
              ...(existing.number !== undefined ? { number: existing.number } : {}),
              ...(existing.html_url ? { html_url: existing.html_url } : {}),
              pr_state: prState,
              ...(merged ? { merged: true } : {}),
              pr_base: prBase,
              head: input.head,
              local_sha: mustHead ?? null,
              remote_sha: typeof priorHead === "string" && SHA.test(priorHead) ? priorHead : null,
            };
            return refusal;
          }
          pr = existing as { number?: number };
          reused = true;
        }
        // #544, #558: the remote could move between the push or the ref read and
        // the request, and a reused PR (the 422 recovery) may sit on another
        // commit. The PR exists now; it is not closed (that would be another
        // write nobody asked for), but the result refuses to vouch for it.
        const prHead = (pr.head as { sha?: unknown } | undefined)?.sha;
        const prHeadSha = typeof prHead === "string" && SHA.test(prHead) ? prHead : null;
        if (mustHead && prHeadSha !== mustHead) {
          const detail = prHeadSha
            ? `the PR's head is ${prHeadSha}, not the local commit ${mustHead}`
            : `GitHub did not report the PR's head commit; the local commit is ${mustHead}`;
          ctx.logger?.warn?.(`  github_create_pr: ${pr.html_url ?? `#${pr.number}`} is not verified: ${detail}`);
          const refusal: ToolRefusal & Record<string, unknown> = {
            refused: true,
            reason: prHeadSha ? REFUSE_PR_MISMATCH : REFUSE_PR_UNVERIFIED,
            detail,
            ...(pr.number !== undefined ? { number: pr.number } : {}),
            ...(pr.html_url ? { html_url: pr.html_url } : {}),
            ...(reused ? { reused: true } : {}),
            head: input.head,
            local_sha: mustHead,
            remote_sha: prHeadSha,
          };
          return refusal;
        }
        try {
          if (pr.number && !reused) {
            await gh(`/repos/${input.repo}/issues/${pr.number}/labels`, ctx, {
              method: "POST",
              body: JSON.stringify({ labels: input.labels ?? ["sweny", "agent"] }),
            });
          }
        } catch (err) {
          // Label failure is non-fatal: the PR is already created and labeling
          // is a best-effort followup. Surface a single warn line naming the
          // PR + failure so operators can tell a label-misconfigured run from
          // a clean one. Without this log, a 5xx from /issues/:n/labels was
          // indistinguishable from success in CI output.
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger?.warn?.(`  github_create_pr: label POST failed for ${pr.html_url ?? `#${pr.number}`} — ${msg}`);
        }
        // The head the PR was opened from: GitHub's answer, else the remote head this run read.
        const headSha = prHeadSha ?? observedHead;
        const out = headSha ? { ...pr, head_sha: headSha } : pr;
        return reused ? { ...out, reused: true } : out;
      },
    },
    {
      name: "github_add_labels",
      access: "write",
      description: "Add labels to a GitHub issue or pull request",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo" },
          issue_number: { type: "number", description: "Issue or PR number" },
          labels: { type: "array", items: { type: "string" }, description: "Labels to add" },
        },
        required: ["repo", "issue_number", "labels"],
      },
      handler: async (input: { repo: string; issue_number: number; labels: string[] }, ctx) =>
        gh(`/repos/${input.repo}/issues/${input.issue_number}/labels`, ctx, {
          method: "POST",
          body: JSON.stringify({ labels: input.labels }),
        }),
    },
    {
      name: "github_set_issue_state",
      access: "write",
      description: "Reopen a closed GitHub issue or pull request, or close an open one",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo" },
          issue_number: { type: "number", description: "Issue or PR number" },
          state: { type: "string", enum: ["reopen", "close"], description: "reopen or close" },
        },
        required: ["repo", "issue_number", "state"],
      },
      handler: async (input: { repo: string; issue_number: number; state: string }, ctx) => {
        if (input.state !== "reopen" && input.state !== "close") {
          throw new Error(`[GitHub] github_set_issue_state: state must be "reopen" or "close"`);
        }
        const reopen = input.state === "reopen";
        return gh(`/repos/${input.repo}/issues/${input.issue_number}`, ctx, {
          method: "PATCH",
          body: JSON.stringify({ state: reopen ? "open" : "closed", state_reason: reopen ? "reopened" : "completed" }),
        });
      },
    },
    {
      name: "github_list_recent_commits",
      access: "read",
      description: "List recent commits on a branch",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo" },
          branch: { type: "string", description: "Branch name (default: main)" },
          per_page: { type: "number", description: "Number of commits (default: 10)" },
        },
        required: ["repo"],
      },
      handler: async (input: { repo: string; branch?: string; per_page?: number }, ctx) =>
        gh(`/repos/${input.repo}/commits?sha=${input.branch ?? "main"}&per_page=${input.per_page ?? 10}`, ctx),
    },
    {
      name: "github_get_file",
      access: "read",
      description: "Get a file's contents from a repository",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo" },
          path: { type: "string", description: "File path in the repo" },
          ref: { type: "string", description: "Branch or commit SHA (default: main)" },
        },
        required: ["repo", "path"],
      },
      handler: async (input: { repo: string; path: string; ref?: string }, ctx) => {
        const ref = input.ref ? `?ref=${encodeURIComponent(input.ref)}` : "";
        const data: any = await gh(`/repos/${input.repo}/contents/${encodeRepoFilePath(input.path)}${ref}`, ctx);
        if (data.content && data.encoding === "base64") {
          return { ...data, decoded_content: Buffer.from(data.content, "base64").toString("utf-8") };
        }
        return data;
      },
    },
    {
      name: "github_list_pr_files",
      access: "read",
      description:
        "List the files changed in a pull request with per-file status and line counts (no patch bodies). " +
        "Use it to size a change and spot risky paths without reading the whole diff.",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo" },
          number: { type: "number", description: "Pull request number" },
        },
        required: ["repo", "number"],
      },
      handler: async (input: { repo: string; number: number }, ctx) => {
        const files = (await gh(`/repos/${input.repo}/pulls/${input.number}/files?per_page=100`, ctx)) as Array<
          Record<string, unknown>
        >;
        return {
          count: files.length,
          truncated: files.length >= 100,
          files: files.map((f) => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            changes: f.changes,
          })),
        };
      },
    },
    {
      name: "github_get_pr_patches",
      access: "read",
      description:
        "Read the patch hunks of named files in a pull request, under hard caps " +
        `(${PR_PATCH_CAPS.maxFiles} files, ${PR_PATCH_CAPS.maxBytesPerFile} bytes a file, ` +
        `${PR_PATCH_CAPS.maxTotalBytes} bytes in all). ` +
        "Each hunk carries its header (e.g. '@@ -10,6 +10,9 @@') and its new-file line range. " +
        "Everything left out is listed in `omitted` with the reason, and cut files are marked `truncated`. " +
        "Pass the riskiest paths first: the caps keep the order you give.",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo" },
          number: { type: "number", description: "Pull request number" },
          paths: {
            type: "array",
            items: { type: "string" },
            description: `Changed file paths to read, most important first (at most ${PR_PATCH_CAPS.maxFiles} are read)`,
          },
        },
        required: ["repo", "number", "paths"],
      },
      handler: async (input: { repo: string; number: number; paths: string[] }, ctx) => {
        const wanted = [...new Set((Array.isArray(input.paths) ? input.paths : []).map(String))];
        const found = new Map<string, Record<string, unknown>>();
        for (let page = 1; page <= PR_FILES_MAX_PAGES; page++) {
          const batch = (await gh(
            `/repos/${input.repo}/pulls/${input.number}/files?per_page=100&page=${page}`,
            ctx,
          )) as Array<Record<string, unknown>>;
          for (const f of batch) if (wanted.includes(String(f.filename))) found.set(String(f.filename), f);
          if (batch.length < 100 || found.size === wanted.length) break;
        }
        return selectPrPatches(wanted, found);
      },
    },
    {
      name: "github_list_dependabot_alerts",
      access: "read",
      description:
        "List open Dependabot security alerts for a repository (package, severity, advisory id, patched version). " +
        "Needs a token with Dependabot alerts read access; the built-in Actions GITHUB_TOKEN does not have it. " +
        "Returns { unavailable: true } instead of throwing when alerts cannot be read.",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo" },
          severity: { type: "string", description: "Optional filter: low, medium, high, or critical" },
        },
        required: ["repo"],
      },
      handler: async (input: { repo: string; severity?: string }, ctx) => {
        const sev = input.severity ? `&severity=${encodeURIComponent(input.severity)}` : "";
        let alerts: Array<Record<string, any>>;
        try {
          alerts = (await gh(`/repos/${input.repo}/dependabot/alerts?state=open&per_page=50${sev}`, ctx)) as Array<
            Record<string, any>
          >;
        } catch (err) {
          if (err instanceof GitHubApiError && (err.status === 403 || err.status === 404)) {
            return { unavailable: true, status: err.status, alerts: [] };
          }
          throw err;
        }
        return {
          unavailable: false,
          count: alerts.length,
          alerts: alerts.map((a) => ({
            number: a.number,
            package: a.dependency?.package?.name,
            ecosystem: a.dependency?.package?.ecosystem,
            manifest: a.dependency?.manifest_path,
            severity: a.security_advisory?.severity,
            ghsa_id: a.security_advisory?.ghsa_id,
            cve_id: a.security_advisory?.cve_id,
            summary: a.security_advisory?.summary,
            vulnerable_range: a.security_vulnerability?.vulnerable_version_range,
            patched_version: a.security_vulnerability?.first_patched_version?.identifier ?? null,
            url: a.html_url,
          })),
        };
      },
    },
  ],
  // Equivalent tool names on GitHub's official MCP server
  // (github.com/github/github-mcp-server). Aliases declared for every
  // GitHub MCP name that does NOT also exist on Linear's MCP. The
  // executor's buildToolAliases already drops any name claimed by more
  // than one loaded skill, so these declarations are safe even if a
  // future provider starts using the same name — declare what this
  // skill knows, let the runtime resolve conflicts.
  //
  // Names that currently exist on both Linear and GitHub MCPs and are
  // therefore intentionally NOT aliased on either side: `get_issue`,
  // `list_issues`.
  mcpAliases: {
    github_create_pr: ["create_pull_request"],
    github_add_comment: ["add_issue_comment"],
    github_create_issue: ["create_issue"],
    github_search_issues: ["search_issues"],
  },
};
