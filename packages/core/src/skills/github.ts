/**
 * GitHub Skill
 *
 * Replaces: source-control/github.ts + issue-tracking/github-issues.ts
 * ~800 lines → ~120 lines
 */

import type { Skill, ToolContext, SkillCategory } from "../types.js";

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
        } catch {
          // Label failure is non-fatal
        }
        return reused ? { ...pr, reused: true } : pr;
      },
    },
    {
      name: "github_list_recent_commits",
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
        const ref = input.ref ? `?ref=${input.ref}` : "";
        const data: any = await gh(`/repos/${input.repo}/contents/${input.path}${ref}`, ctx);
        if (data.content && data.encoding === "base64") {
          return { ...data, decoded_content: Buffer.from(data.content, "base64").toString("utf-8") };
        }
        return data;
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
