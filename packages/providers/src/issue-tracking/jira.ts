import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type {
  IssueTrackingProvider,
  Issue,
  IssueCreateOptions,
  IssueUpdateOptions,
  IssueSearchOptions,
  PrLinkCapable,
  LabelHistoryCapable,
  IssueHistoryEntry,
} from "./types.js";
import type { ProviderConfigSchema } from "../config-schema.js";

/** Escape a value for safe embedding inside a JQL quoted string. */
function escapeJql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export const jiraConfigSchema = z.object({
  baseUrl: z
    .string()
    .min(1, "Jira base URL is required")
    .refine((u) => u.startsWith("https://"), "baseUrl must start with https://"),
  email: z.string().min(1, "Jira account email is required"),
  apiToken: z.string().min(1, "Jira API token is required"),
  logger: z.custom<Logger>().optional(),
});

export type JiraConfig = z.infer<typeof jiraConfigSchema>;

export const jiraProviderConfigSchema: ProviderConfigSchema = {
  role: "issueTracker",
  name: "Jira",
  fields: [
    { key: "baseUrl", envVar: "JIRA_BASE_URL", description: "Jira base URL (e.g. https://yourorg.atlassian.net)" },
    { key: "email", envVar: "JIRA_EMAIL", description: "Jira account email" },
    { key: "apiToken", envVar: "JIRA_API_TOKEN", description: "Jira API token" },
  ],
};

export function jira(
  config: JiraConfig,
): IssueTrackingProvider & PrLinkCapable & LabelHistoryCapable & { configSchema: ProviderConfigSchema } {
  const parsed = jiraConfigSchema.parse(config);
  const provider = new JiraProvider(parsed);
  return Object.assign(provider, { configSchema: jiraProviderConfigSchema });
}

class JiraProvider implements IssueTrackingProvider, PrLinkCapable, LabelHistoryCapable {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly log: Logger;

  constructor(config: JiraConfig) {
    // Strip trailing slash for consistency
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.authHeader = `Basic ${btoa(`${config.email}:${config.apiToken}`)}`;
    this.log = config.logger ?? consoleLogger;
  }

  private async request<T>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
    const url = `${this.baseUrl}/rest/api/3${path}`;
    const response = await fetch(url, {
      method: opts?.method ?? "GET",
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        ...(opts?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderApiError("Jira", response.status, response.statusText, body);
    }

    // Some endpoints (204 No Content) return no body
    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  // ------------------------------------------------------------------
  // IssueTrackingProvider
  // ------------------------------------------------------------------

  async verifyAccess(): Promise<void> {
    this.log.info("Verifying Jira API access...");

    const result = await this.request<{ emailAddress: string; displayName: string }>("/myself");

    this.log.info(`Jira access verified as ${result.displayName} (${result.emailAddress})`);
  }

  async createIssue(opts: IssueCreateOptions): Promise<Issue> {
    this.log.info(`Creating Jira issue: ${opts.title}`);

    const fields: Record<string, unknown> = {
      summary: opts.title,
      project: { key: opts.projectId },
      issuetype: { name: "Task" },
    };

    if (opts.description) {
      fields.description = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: opts.description }],
          },
        ],
      };
    }

    if (opts.labels && opts.labels.length > 0) {
      fields.labels = opts.labels;
    }

    if (opts.priority) {
      fields.priority = { id: String(opts.priority) };
    }

    if (opts.stateId) {
      // stateId maps to a Jira status; cannot be set at creation via fields,
      // so we transition after creation below.
    }

    const result = await this.request<{
      id: string;
      key: string;
      self: string;
    }>("/issue", { method: "POST", body: { fields } });

    // If a target state was requested, attempt a transition
    if (opts.stateId) {
      try {
        await this.transitionIssue(result.key, opts.stateId);
      } catch {
        this.log.warn(`Could not transition new issue ${result.key} to state ${opts.stateId}`);
      }
    }

    const issue = await this.getIssue(result.key);
    this.log.info(`Created issue ${issue.identifier} (${issue.url})`);

    return issue;
  }

  async getIssue(identifier: string): Promise<Issue> {
    this.log.info(`Fetching Jira issue ${identifier}`);

    const result = await this.request<{
      id: string;
      key: string;
      fields: {
        summary: string;
        status: { name: string };
      };
    }>(`/issue/${encodeURIComponent(identifier)}?fields=summary,status`);

    return {
      id: result.id,
      identifier: result.key,
      title: result.fields.summary,
      url: `${this.baseUrl}/browse/${result.key}`,
      branchName: `fix/${result.key}`,
      state: result.fields.status.name,
    };
  }

  async updateIssue(issueId: string, opts: IssueUpdateOptions): Promise<void> {
    this.log.info(`Updating Jira issue ${issueId}`);

    if (opts.description) {
      const fields: Record<string, unknown> = {
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: opts.description }],
            },
          ],
        },
      };
      await this.request(`/issue/${encodeURIComponent(issueId)}`, {
        method: "PUT",
        body: { fields },
      });
      this.log.info(`Issue ${issueId} description updated`);
    }

    if (opts.stateId) {
      await this.transitionIssue(issueId, opts.stateId);
      this.log.info(`Issue ${issueId} transitioned to ${opts.stateId}`);
    }

    if (opts.comment) {
      await this.addComment(issueId, opts.comment);
    }
  }

  async searchIssues(opts: IssueSearchOptions): Promise<Issue[]> {
    this.log.info(`Searching Jira issues: "${opts.query}" in project ${opts.projectId}`);

    const jqlParts: string[] = [
      `project = "${escapeJql(opts.projectId ?? "")}"`,
      `summary ~ "${escapeJql(opts.query)}"`,
    ];

    if (opts.labels && opts.labels.length > 0) {
      const labelClauses = opts.labels.map((l) => `labels = "${escapeJql(l)}"`).join(" AND ");
      jqlParts.push(`(${labelClauses})`);
    }

    if (opts.states && opts.states.length > 0) {
      const stateList = opts.states.map((s) => `"${escapeJql(s)}"`).join(", ");
      jqlParts.push(`status IN (${stateList})`);
    }

    const jql = jqlParts.join(" AND ");

    const result = await this.request<{
      issues: Array<{
        id: string;
        key: string;
        fields: {
          summary: string;
          status: { name: string };
        };
      }>;
    }>(`/search?jql=${encodeURIComponent(jql)}&maxResults=10&fields=summary,status`);

    const issues = result.issues ?? [];
    this.log.info(`Found ${issues.length} matching issues`);

    return issues.map((i) => ({
      id: i.id,
      identifier: i.key,
      title: i.fields.summary,
      url: `${this.baseUrl}/browse/${i.key}`,
      branchName: `fix/${i.key}`,
      state: i.fields.status.name,
    }));
  }

  async addComment(issueId: string, body: string): Promise<void> {
    await this.request(`/issue/${encodeURIComponent(issueId)}/comment`, {
      method: "POST",
      body: {
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: body }],
            },
          ],
        },
      },
    });
    this.log.info(`Comment added to issue ${issueId}`);
  }

  // ------------------------------------------------------------------
  // PrLinkCapable
  // ------------------------------------------------------------------

  async linkPr(issueId: string, prUrl: string, prNumber: number): Promise<void> {
    this.log.info(`Linking PR #${prNumber} to issue ${issueId}`);

    // Add a remote link pointing to the pull request
    await this.request(`/issue/${encodeURIComponent(issueId)}/remotelink`, {
      method: "POST",
      body: {
        object: {
          url: prUrl,
          title: `Pull Request #${prNumber}`,
          icon: {
            url16x16: "https://github.githubassets.com/favicons/favicon.png",
            title: "GitHub PR",
          },
        },
      },
    });

    // Also leave a comment for visibility in the issue activity stream
    await this.addComment(issueId, `Pull Request Created: PR #${prNumber} — ${prUrl}`);

    this.log.info(`PR #${prNumber} linked to issue ${issueId}`);
  }

  // ------------------------------------------------------------------
  // LabelHistoryCapable
  // ------------------------------------------------------------------

  async searchIssuesByLabel(
    projectId: string,
    labelId: string,
    opts?: { days?: number },
  ): Promise<IssueHistoryEntry[]> {
    const days = opts?.days ?? 30;
    this.log.info(`Searching Jira issues by label ${labelId} in project ${projectId} (last ${days} days)`);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0]; // YYYY-MM-DD format for Jira JQL

    const jql = `project = "${escapeJql(projectId)}" AND labels = "${escapeJql(labelId)}" AND created >= "${since}" ORDER BY created DESC`;

    const result = await this.request<{
      issues: Array<{
        id: string;
        key: string;
        fields: {
          summary: string;
          status: { name: string; statusCategory: { key: string } };
          description: unknown | null;
          labels: string[];
          created: string;
        };
      }>;
    }>(`/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,status,description,labels,created`);

    const issues = result.issues ?? [];
    this.log.info(`Found ${issues.length} issues with label ${labelId}`);

    return issues.map((i) => {
      // Extract plain text from Atlassian Document Format description
      let descriptionSnippet: string | null = null;
      if (i.fields.description) {
        const doc = i.fields.description as { content?: Array<{ content?: Array<{ text?: string }> }> };
        const text = doc.content
          ?.flatMap((block) => block.content ?? [])
          .map((node) => node.text ?? "")
          .join(" ")
          .trim();
        descriptionSnippet = text ? text.slice(0, 200) : null;
      }

      return {
        identifier: i.key,
        title: i.fields.summary,
        state: i.fields.status.name,
        stateType: i.fields.status.statusCategory.key,
        url: `${this.baseUrl}/browse/${i.key}`,
        descriptionSnippet,
        createdAt: i.fields.created,
        labels: i.fields.labels,
      };
    });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Transition an issue to the target status name by looking up available
   * transitions and executing the one whose `to.name` matches (case-insensitive).
   */
  private async transitionIssue(issueKeyOrId: string, targetStatusName: string): Promise<void> {
    const { transitions } = await this.request<{
      transitions: Array<{
        id: string;
        to: { name: string };
      }>;
    }>(`/issue/${encodeURIComponent(issueKeyOrId)}/transitions`);

    const target = transitions.find((t) => t.to.name.toLowerCase() === targetStatusName.toLowerCase());

    if (!target) {
      const available = transitions.map((t) => t.to.name).join(", ");
      throw new Error(
        `No transition to status "${targetStatusName}" for issue ${issueKeyOrId}. Available: ${available}`,
      );
    }

    await this.request(`/issue/${encodeURIComponent(issueKeyOrId)}/transitions`, {
      method: "POST",
      body: { transition: { id: target.id } },
    });
  }
}
