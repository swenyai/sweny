import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type {
  IssueTrackingProvider,
  Issue,
  IssueCreateOptions,
  IssueUpdateOptions,
  IssueSearchOptions,
  PrLinkCapable,
  FingerprintCapable,
  TriageHistoryCapable,
  TriageHistoryEntry,
} from "./types.js";

const LINEAR_API_URL = "https://api.linear.app/graphql";

const DEFAULT_OPEN_STATES = [
  "Triage",
  "Backlog",
  "Todo",
  "In Progress",
  "Peer Review",
  "In Review",
  "QA",
  "Blocked",
];

export const linearConfigSchema = z.object({
  apiKey: z.string().min(1, "Linear API key is required"),
  logger: z.custom<Logger>().optional(),
});

export type LinearConfig = z.infer<typeof linearConfigSchema>;

export function linear(
  config: LinearConfig,
): IssueTrackingProvider & PrLinkCapable & FingerprintCapable & TriageHistoryCapable {
  const parsed = linearConfigSchema.parse(config);
  return new LinearProvider(parsed);
}

class LinearProvider
  implements IssueTrackingProvider, PrLinkCapable, FingerprintCapable, TriageHistoryCapable
{
  private readonly apiKey: string;
  private readonly log: Logger;

  constructor(config: LinearConfig) {
    this.apiKey = config.apiKey;
    this.log = config.logger ?? consoleLogger;
  }

  private async request<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(LINEAR_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(
        `Linear API error: ${response.status} ${response.statusText}`,
      );
    }

    const json = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };

    if (json.errors && json.errors.length > 0) {
      throw new Error(
        `Linear GraphQL error: ${json.errors.map((e) => e.message).join(", ")}`,
      );
    }

    return json.data as T;
  }

  async verifyAccess(): Promise<void> {
    this.log.info("Verifying Linear API access...");

    const result = await this.request<{
      viewer: { id: string; name: string };
    }>(`
      query {
        viewer {
          id
          name
        }
      }
    `);

    this.log.info(`Linear access verified as ${result.viewer.name} (${result.viewer.id})`);
  }

  async createIssue(opts: IssueCreateOptions): Promise<Issue> {
    this.log.info(`Creating Linear issue: ${opts.title}`);

    const input: Record<string, unknown> = {
      title: opts.title,
      teamId: opts.projectId,
    };

    if (opts.description !== undefined) input.description = opts.description;
    if (opts.labels !== undefined) input.labelIds = opts.labels;
    if (opts.priority !== undefined) input.priority = opts.priority;
    if (opts.stateId !== undefined) input.stateId = opts.stateId;

    const mutation = `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
            url
            branchName
          }
        }
      }
    `;

    const result = await this.request<{
      issueCreate: {
        success: boolean;
        issue: {
          id: string;
          identifier: string;
          title: string;
          url: string;
          branchName: string;
        };
      };
    }>(mutation, { input });

    if (!result.issueCreate.success) {
      throw new Error("Failed to create Linear issue");
    }

    const issue = result.issueCreate.issue;
    this.log.info(`Created issue ${issue.identifier} (${issue.url})`);

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      branchName: issue.branchName,
    };
  }

  async getIssue(identifier: string): Promise<Issue> {
    this.log.info(`Fetching Linear issue ${identifier}`);

    const query = `
      query GetIssue($identifier: String!) {
        issue(id: $identifier) {
          id
          identifier
          title
          url
          branchName
          state {
            name
          }
        }
      }
    `;

    const result = await this.request<{
      issue: {
        id: string;
        identifier: string;
        title: string;
        url: string;
        branchName: string;
        state: { name: string };
      };
    }>(query, { identifier });

    if (!result.issue) {
      throw new Error(`Issue "${identifier}" not found`);
    }

    const issue = result.issue;
    this.log.debug(
      `Fetched issue ${issue.identifier}: ${issue.title} [${issue.state.name}]`,
    );

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      branchName: issue.branchName,
      state: issue.state.name,
    };
  }

  async updateIssue(issueId: string, opts: IssueUpdateOptions): Promise<void> {
    this.log.info(`Updating Linear issue ${issueId}`);

    if (opts.stateId || opts.description) {
      const updateInput: Record<string, unknown> = {};
      if (opts.stateId) updateInput.stateId = opts.stateId;
      if (opts.description) updateInput.description = opts.description;

      await this.request(
        `
        mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
            issue { id identifier state { name } }
          }
        }
      `,
        { id: issueId, input: updateInput },
      );
      this.log.info(`Issue ${issueId} fields updated`);
    }

    if (opts.comment) {
      await this.addComment(issueId, opts.comment);
    }
  }

  async searchIssues(opts: IssueSearchOptions): Promise<Issue[]> {
    const stateNames = opts.states ?? DEFAULT_OPEN_STATES;

    this.log.info(
      `Searching Linear issues: "${opts.query}" in project ${opts.projectId}`,
    );

    const query = `
      query SearchIssues($teamId: String!, $filter: IssueFilter) {
        team(id: $teamId) {
          issues(filter: $filter, first: 10) {
            nodes {
              id
              identifier
              title
              url
              branchName
              state { name }
              createdAt
              updatedAt
            }
          }
        }
      }
    `;

    const filter: Record<string, unknown> = {
      title: { containsIgnoreCase: opts.query },
      state: { name: { in: stateNames } },
    };

    if (opts.labels && opts.labels.length > 0) {
      filter.labels = { id: { eq: opts.labels[0] } };
    }

    const result = await this.request<{
      team: {
        issues: {
          nodes: Array<{
            id: string;
            identifier: string;
            title: string;
            url: string;
            branchName: string;
            state: { name: string };
          }>;
        };
      };
    }>(query, { teamId: opts.projectId, filter });

    const issues = result.team?.issues?.nodes ?? [];
    this.log.info(`Found ${issues.length} matching issues`);

    return issues.map((i) => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      url: i.url,
      branchName: i.branchName,
      state: i.state.name,
    }));
  }

  async addComment(issueId: string, body: string): Promise<void> {
    await this.request(
      `
      mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) { success }
      }
    `,
      { input: { issueId, body } },
    );
    this.log.info(`Comment added to issue ${issueId}`);
  }

  async linkPr(
    issueId: string,
    prUrl: string,
    prNumber: number,
  ): Promise<void> {
    this.log.info(`Linking PR #${prNumber} to issue ${issueId}`);

    await this.request(
      `
      mutation CreateAttachment($input: AttachmentCreateInput!) {
        attachmentCreate(input: $input) { success attachment { id } }
      }
    `,
      { input: { issueId, url: prUrl, title: `GitHub PR #${prNumber}` } },
    );

    await this.addComment(
      issueId,
      `**Pull Request Created**: [PR #${prNumber}](${prUrl})`,
    );

    this.log.info(`PR #${prNumber} linked to issue ${issueId}`);
  }

  async listTriageHistory(
    projectId: string,
    labelId: string,
    days: number = 30,
  ): Promise<TriageHistoryEntry[]> {
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    this.log.info(
      `Listing triage history for project ${projectId} (last ${days} days)`,
    );

    const query = `
      query TriageHistory($teamId: String!, $filter: IssueFilter) {
        team(id: $teamId) {
          issues(filter: $filter, first: 50, orderBy: createdAt) {
            nodes {
              id
              identifier
              title
              url
              description
              state { name type }
              createdAt
              updatedAt
              labels { nodes { name } }
            }
          }
        }
      }
    `;

    const filter: Record<string, unknown> = {
      labels: { id: { eq: labelId } },
      createdAt: { gte: since },
    };

    const result = await this.request<{
      team: {
        issues: {
          nodes: Array<{
            id: string;
            identifier: string;
            title: string;
            url: string;
            description: string | null;
            state: { name: string; type: string };
            createdAt: string;
            labels: { nodes: Array<{ name: string }> };
          }>;
        };
      };
    }>(query, { teamId: projectId, filter });

    const issues = result.team?.issues?.nodes ?? [];

    const entries: TriageHistoryEntry[] = issues.map((issue) => {
      let fingerprint: string | null = null;
      if (issue.description) {
        const match = issue.description.match(
          /<!-- TRIAGE_FINGERPRINT\n([\s\S]*?)-->/,
        );
        if (match) {
          fingerprint = match[1].trim();
        }
      }

      return {
        identifier: issue.identifier,
        title: issue.title,
        state: issue.state.name,
        stateType: issue.state.type,
        url: issue.url,
        descriptionSnippet: issue.description
          ? issue.description.slice(0, 200)
          : null,
        fingerprint,
        createdAt: issue.createdAt,
        labels: issue.labels.nodes.map((l) => l.name),
      };
    });

    this.log.info(`Found ${entries.length} triage history entries`);

    return entries;
  }

  async searchByFingerprint(
    projectId: string,
    errorPattern: string,
    opts?: { labelId?: string; service?: string },
  ): Promise<Issue[]> {
    this.log.info(
      `Searching by fingerprint: "${errorPattern}" in project ${projectId}`,
    );

    const query = `
      query FingerprintSearch($teamId: String!, $filter: IssueFilter) {
        team(id: $teamId) {
          issues(filter: $filter, first: 50, orderBy: updatedAt) {
            nodes {
              id
              identifier
              title
              url
              branchName
              description
              state { name type }
            }
          }
        }
      }
    `;

    const filter: Record<string, unknown> = {};
    if (opts?.labelId) {
      filter.labels = { id: { eq: opts.labelId } };
    }
    filter.createdAt = {
      gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const result = await this.request<{
      team: {
        issues: {
          nodes: Array<{
            id: string;
            identifier: string;
            title: string;
            url: string;
            branchName: string;
            description: string | null;
            state: { name: string; type: string };
          }>;
        };
      };
    }>(query, { teamId: projectId, filter });

    const issues = result.team?.issues?.nodes ?? [];
    const pattern = errorPattern.toLowerCase();
    const service = opts?.service?.toLowerCase();

    const matches = issues.filter((issue) => {
      if (!issue.description) return false;
      const desc = issue.description.toLowerCase();

      const fpMatch = desc.match(/<!-- triage_fingerprint\n([\s\S]*?)-->/);
      if (fpMatch) {
        const fp = fpMatch[1];
        const hasErrorMatch = fp.includes(pattern);
        const hasServiceMatch = !service || fp.includes(service);
        if (hasErrorMatch && hasServiceMatch) return true;
      }

      return desc.includes(pattern);
    });

    this.log.info(`Found ${matches.length} issues matching fingerprint`);

    return matches.map((m) => ({
      id: m.id,
      identifier: m.identifier,
      title: m.title,
      url: m.url,
      branchName: m.branchName,
      state: m.state.name,
    }));
  }
}
