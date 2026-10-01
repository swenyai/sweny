/**
 * GitHub Skill
 *
 * Replaces: source-control/github.ts + issue-tracking/github-issues.ts
 * ~800 lines → ~120 lines
 */

import type { Skill, ToolContext, SkillCategory } from "../types.js";

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

async function gh(path: string, ctx: ToolContext, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
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
      handler: async (input: { repo: string; issue_number: number; body: string }, ctx) =>
        gh(`/repos/${input.repo}/issues/${input.issue_number}/comments`, ctx, {
          method: "POST",
          body: JSON.stringify({ body: input.body }),
        }),
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
        // #473: push the head branch from sweny with this skill's token, so the
        // recommended `persist-credentials: false` checkout still ships the
        // branch and the agent never holds a write token. Skipped unless the
        // branch exists locally and origin is this repo; never forced.
        if (ctx.pushBranch) {
          const push = await ctx.pushBranch({
            repo: input.repo,
            head: input.head,
            base: input.base ?? "main",
            token: ctx.config.GITHUB_TOKEN,
          });
          if (push.pushed) ctx.logger?.info?.(`  github_create_pr: pushed ${input.head} to ${input.repo}`);
          else if (push.attempted) ctx.logger?.warn?.(`  github_create_pr: ${push.reason}; requesting the PR anyway`);
          else ctx.logger?.debug?.(`  github_create_pr: no sweny-side push (${push.reason})`);
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
          const owner = input.repo.split("/")[0];
          const headQ = encodeURIComponent(`${owner}:${input.head}`);
          const open = (await gh(`/repos/${input.repo}/pulls?head=${headQ}&state=open&per_page=1`, ctx)) as Array<{
            number?: number;
          }>;
          const existing =
            open[0] ??
            (
              (await gh(`/repos/${input.repo}/pulls?head=${headQ}&state=all&per_page=1`, ctx)) as Array<{
                number?: number;
              }>
            )[0];
          if (!existing) throw err;
          pr = existing as { number?: number };
          reused = true;
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
        return reused ? { ...pr, reused: true } : pr;
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
