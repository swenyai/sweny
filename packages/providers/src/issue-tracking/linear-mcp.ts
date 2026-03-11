/**
 * MCP-backed Linear provider adapter.
 *
 * Wraps the `@linear/mcp` MCP server and satisfies the standard
 * IssueTrackingProvider + PrLinkCapable + LabelHistoryCapable interfaces.
 *
 * REQUIREMENTS:
 *   - `@modelcontextprotocol/sdk` must be installed
 *   - `npx` must be available (the server is spawned via npx)
 *   - `LINEAR_API_KEY` must be set (passed via env to the server process)
 *
 * KNOWN GAPS vs. the native `linear()` provider:
 *   - searchIssuesByLabel: Linear MCP `search_issues` does not support `createdAfter`
 *     → fetches up to 100 results and filters client-side by createdAt
 *   - branchName: derived from identifier if not present in MCP response
 *   - Tool names: defaulted from `@linear/mcp` v1.x; override via `toolMap` if the
 *     server version you use exposes different names
 */
import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { MCPClient } from "./client.js";
import type {
  IssueTrackingProvider,
  Issue,
  IssueCreateOptions,
  IssueUpdateOptions,
  IssueSearchOptions,
  IssueHistoryEntry,
  PrLinkCapable,
  LabelHistoryCapable,
} from "../issue-tracking/types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const linearMCPConfigSchema = z.object({
  apiKey: z.string().min(1, "Linear API key is required"),
  /**
   * Override MCP tool names if your `@linear/mcp` version uses different names.
   * Defaults match `@linear/mcp` v1.x.
   */
  toolMap: z
    .object({
      createIssue: z.string().default("create_issue"),
      getIssue: z.string().default("get_issue"),
      updateIssue: z.string().default("update_issue"),
      searchIssues: z.string().default("search_issues"),
      addComment: z.string().default("add_comment"),
      linkPr: z.string().default("create_attachment"),
    })
    .optional(),
  logger: z.custom<Logger>().optional(),
});

export type LinearMCPConfig = z.infer<typeof linearMCPConfigSchema>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function linearMCP(config: LinearMCPConfig): IssueTrackingProvider & PrLinkCapable & LabelHistoryCapable {
  const parsed = linearMCPConfigSchema.parse(config);
  const tools = {
    createIssue: "create_issue",
    getIssue: "get_issue",
    updateIssue: "update_issue",
    searchIssues: "search_issues",
    addComment: "add_comment",
    linkPr: "create_attachment",
    ...parsed.toolMap,
  };
  const log = parsed.logger ?? consoleLogger;

  const client = new MCPClient("linear-mcp", {
    command: "npx",
    args: ["-y", "@linear/mcp"],
    env: { LINEAR_API_KEY: parsed.apiKey },
  });

  function toIssue(raw: Record<string, unknown>): Issue {
    const id = String(raw.id ?? raw.identifier ?? "");
    const identifier = String(raw.identifier ?? raw.id ?? "");
    return {
      id,
      identifier,
      title: String(raw.title ?? ""),
      url: String(raw.url ?? ""),
      branchName: raw.branchName
        ? String(raw.branchName)
        : `fix/${identifier.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      state: raw.state ? String((raw.state as Record<string, unknown>).name ?? raw.state) : undefined,
      description: raw.description ? String(raw.description) : undefined,
    };
  }

  return {
    async verifyAccess(): Promise<void> {
      await client.connect();
      log.info(`Linear MCP connected; tools: ${client.availableTools().join(", ")}`);
    },

    async createIssue(opts: IssueCreateOptions): Promise<Issue> {
      const raw = await client.call<Record<string, unknown>>(tools.createIssue, {
        title: opts.title,
        teamId: opts.projectId,
        description: opts.description,
        labelIds: opts.labels,
        priority: opts.priority,
        stateId: opts.stateId,
      });
      log.info(`Linear MCP: created issue ${raw.identifier}`);
      return toIssue(raw);
    },

    async getIssue(identifier: string): Promise<Issue> {
      const raw = await client.call<Record<string, unknown>>(tools.getIssue, { issueId: identifier });
      return toIssue(raw);
    },

    async updateIssue(issueId: string, opts: IssueUpdateOptions): Promise<void> {
      await client.call(tools.updateIssue, {
        issueId,
        stateId: opts.stateId,
        description: opts.description,
      });
      if (opts.comment) {
        await client.call(tools.addComment, { issueId, body: opts.comment });
      }
      log.info(`Linear MCP: updated issue ${issueId}`);
    },

    async searchIssues(opts: IssueSearchOptions): Promise<Issue[]> {
      const raw = await client.call<unknown[]>(tools.searchIssues, {
        query: opts.query,
        teamId: opts.projectId,
        labels: opts.labels,
        states: opts.states,
      });
      return (raw ?? []).map((r) => toIssue(r as Record<string, unknown>));
    },

    async addComment(issueId: string, body: string): Promise<void> {
      await client.call(tools.addComment, { issueId, body });
    },

    async linkPr(issueId: string, prUrl: string, prNumber: number): Promise<void> {
      await client.call(tools.linkPr, {
        issueId,
        title: `Pull Request #${prNumber}`,
        url: prUrl,
      });
    },

    async searchIssuesByLabel(
      projectId: string,
      labelId: string,
      opts?: { days?: number },
    ): Promise<IssueHistoryEntry[]> {
      const days = opts?.days ?? 30;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      // NOTE: Linear MCP search_issues does not support createdAfter — fetch broadly
      // and filter client-side. Increase limit if you have high volume.
      const raw = await client.call<unknown[]>(tools.searchIssues, {
        teamId: projectId,
        labels: [labelId],
        limit: 100,
      });

      return (raw ?? [])
        .map((r) => r as Record<string, unknown>)
        .filter((r) => {
          const createdAt = String(r.createdAt ?? "");
          return createdAt >= cutoff;
        })
        .map((r) => {
          const state = r.state as Record<string, unknown> | undefined;
          return {
            identifier: String(r.identifier ?? r.id ?? ""),
            title: String(r.title ?? ""),
            state: String(state?.name ?? r.state ?? ""),
            stateType: String(state?.type ?? "started"),
            url: String(r.url ?? ""),
            descriptionSnippet: r.description ? String(r.description).slice(0, 200) : null,
            createdAt: String(r.createdAt ?? ""),
            labels: Array.isArray(r.labels)
              ? (r.labels as Array<Record<string, unknown>>).map((l) => String(l.name ?? l))
              : [],
          };
        });
    },
  };
}
