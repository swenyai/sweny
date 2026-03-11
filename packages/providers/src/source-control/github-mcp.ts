/**
 * MCP-backed GitHub source control adapter — satisfies RepoProvider ONLY.
 *
 * Wraps the `@modelcontextprotocol/server-github` MCP server and satisfies
 * the RepoProvider interface (remote API calls only).
 *
 * ⚠️  THIS IS NOT A SourceControlProvider.
 *
 * It intentionally does NOT implement GitProvider. Local git operations
 * (createBranch, pushBranch, stageAndCommit, etc.) require a git process
 * running in a local working directory — they cannot come from a remote MCP
 * server. If you need both halves, pair this with a local GitProvider.
 *
 * REQUIREMENTS:
 *   - `@modelcontextprotocol/sdk` must be installed
 *   - `npx` must be available
 *   - `GITHUB_PERSONAL_ACCESS_TOKEN` with repo + workflow scopes
 *
 * KNOWN GAPS vs. the native `github()` provider:
 *   - `enableAutoMerge`: GitHub MCP server does not expose this — omitted.
 *   - `dispatchWorkflow`: uses `create_workflow_dispatch`; verify the tool
 *     name matches your version of `@modelcontextprotocol/server-github`.
 *   - PR state mapping: MCP returns "open"/"closed" — "merged" is inferred
 *     from `mergedAt` being present.
 */
import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { MCPClient } from "../mcp/client.js";
import type { RepoProvider, PullRequest, PrCreateOptions, PrListOptions, DispatchWorkflowOptions } from "./types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const githubMCPConfigSchema = z.object({
  personalAccessToken: z.string().min(1, "GitHub personal access token is required"),
  /** "owner/repo" — used as default for PR operations. */
  repo: z.string().min(1, "GitHub repo (owner/repo) is required"),
  /**
   * Override MCP tool names if your server version differs from defaults.
   * Defaults match `@modelcontextprotocol/server-github` v1.x.
   */
  toolMap: z
    .object({
      createPullRequest: z.string().default("create_pull_request"),
      listPullRequests: z.string().default("list_pull_requests"),
      getPullRequest: z.string().default("get_pull_request"),
      createWorkflowDispatch: z.string().default("create_workflow_dispatch"),
    })
    .optional(),
  logger: z.custom<Logger>().optional(),
});

export type GitHubMCPConfig = z.infer<typeof githubMCPConfigSchema>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function githubMCP(config: GitHubMCPConfig): RepoProvider {
  const parsed = githubMCPConfigSchema.parse(config);
  const log = parsed.logger ?? consoleLogger;

  const tools = {
    createPullRequest: "create_pull_request",
    listPullRequests: "list_pull_requests",
    getPullRequest: "get_pull_request",
    createWorkflowDispatch: "create_workflow_dispatch",
    ...parsed.toolMap,
  };

  const [owner, repoName] = parsed.repo.split("/");

  const client = new MCPClient("github-mcp", {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: parsed.personalAccessToken },
  });

  function toPullRequest(raw: Record<string, unknown>): PullRequest {
    const mergedAt = raw.merged_at ? String(raw.merged_at) : null;
    const closedAt = raw.closed_at ? String(raw.closed_at) : null;
    const rawState = String(raw.state ?? "open");
    const state: PullRequest["state"] = mergedAt ? "merged" : rawState === "closed" ? "closed" : "open";
    return {
      number: Number(raw.number ?? 0),
      url: String(raw.html_url ?? raw.url ?? ""),
      state,
      title: String(raw.title ?? ""),
      mergedAt,
      closedAt,
    };
  }

  return {
    async verifyAccess(): Promise<void> {
      await client.connect();
      log.info(`GitHub MCP connected; tools: ${client.availableTools().join(", ")}`);
    },

    async createPullRequest(opts: PrCreateOptions): Promise<PullRequest> {
      const raw = await client.call<Record<string, unknown>>(tools.createPullRequest, {
        owner,
        repo: repoName,
        title: opts.title,
        body: opts.body,
        head: opts.head,
        base: opts.base ?? "main",
        labels: opts.labels,
      });
      log.info(`GitHub MCP: created PR #${raw.number}`);
      return toPullRequest(raw);
    },

    async listPullRequests(opts?: PrListOptions): Promise<PullRequest[]> {
      const state = opts?.state === "all" ? undefined : (opts?.state ?? "open");
      const raw = await client.call<unknown[]>(tools.listPullRequests, {
        owner,
        repo: repoName,
        state,
        per_page: opts?.limit ?? 30,
      });
      return (raw ?? []).map((r) => toPullRequest(r as Record<string, unknown>));
    },

    async findExistingPr(searchTerm: string): Promise<PullRequest | null> {
      const prs = await this.listPullRequests({ state: "open" });
      return prs.find((pr) => pr.title.includes(searchTerm)) ?? null;
    },

    async dispatchWorkflow(opts: DispatchWorkflowOptions): Promise<void> {
      const [wfOwner, wfRepo] = opts.targetRepo.split("/");
      await client.call(tools.createWorkflowDispatch, {
        owner: wfOwner,
        repo: wfRepo,
        workflow_id: opts.workflow,
        ref: "main",
        inputs: opts.inputs ?? {},
      });
      log.info(`GitHub MCP: dispatched workflow ${opts.workflow} on ${opts.targetRepo}`);
    },

    // enableAutoMerge intentionally omitted — not supported by MCP server.
  };
}
