import * as core from "@actions/core";
import {
  IssueTrackerProvider,
  Issue,
  IssueCreateOptions,
  IssueSearchOptions,
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

export class LinearProvider implements IssueTrackerProvider {
  private readonly apiKey: string;

  constructor(config: { apiKey: string }) {
    this.apiKey = config.apiKey;
  }

  // ---------------------------------------------------------------------------
  // Private GraphQL transport
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // 1. verifyAccess
  // ---------------------------------------------------------------------------

  async verifyAccess(): Promise<void> {
    core.info("Verifying Linear API access...");

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

    core.info(`Linear access verified as ${result.viewer.name} (${result.viewer.id})`);
  }

  // ---------------------------------------------------------------------------
  // 2. createIssue
  // ---------------------------------------------------------------------------

  async createIssue(opts: IssueCreateOptions): Promise<Issue> {
    core.info(`Creating Linear issue: ${opts.title}`);

    const input: Record<string, unknown> = {
      title: opts.title,
      teamId: opts.teamId,
    };

    if (opts.description !== undefined) {
      input.description = opts.description;
    }
    if (opts.labelIds !== undefined) {
      input.labelIds = opts.labelIds;
    }
    if (opts.priority !== undefined) {
      input.priority = opts.priority;
    }
    if (opts.stateId !== undefined) {
      input.stateId = opts.stateId;
    }

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
    core.info(`Created issue ${issue.identifier} (${issue.url})`);

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      branchName: issue.branchName,
    };
  }

  // ---------------------------------------------------------------------------
  // 3. updateIssue
  // ---------------------------------------------------------------------------

  async updateIssue(
    issueId: string,
    opts: { stateId?: string; description?: string; comment?: string },
  ): Promise<void> {
    core.info(`Updating Linear issue ${issueId}`);

    // Update issue fields if stateId or description are provided
    if (opts.stateId || opts.description) {
      const updateInput: Record<string, unknown> = {};
      if (opts.stateId) updateInput.stateId = opts.stateId;
      if (opts.description) updateInput.description = opts.description;

      const mutation = `
        mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
            issue {
              id
              identifier
              state {
                name
              }
            }
          }
        }
      `;

      await this.request(mutation, { id: issueId, input: updateInput });
      core.info(`Issue ${issueId} fields updated`);
    }

    // Add comment if provided
    if (opts.comment) {
      const commentMutation = `
        mutation CreateComment($input: CommentCreateInput!) {
          commentCreate(input: $input) {
            success
          }
        }
      `;

      await this.request(commentMutation, {
        input: {
          issueId,
          body: opts.comment,
        },
      });

      core.info(`Comment added to issue ${issueId}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 4. getIssue
  // ---------------------------------------------------------------------------

  async getIssue(identifier: string): Promise<Issue> {
    core.info(`Fetching Linear issue ${identifier}`);

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
    core.debug(
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

  // ---------------------------------------------------------------------------
  // 5. searchIssues
  // ---------------------------------------------------------------------------

  async searchIssues(opts: IssueSearchOptions): Promise<Issue[]> {
    const stateNames = opts.states ?? DEFAULT_OPEN_STATES;

    core.info(
      `Searching Linear issues: "${opts.query}" in team ${opts.teamId}`,
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
              state {
                name
              }
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

    if (opts.labelId) {
      filter.labels = { id: { eq: opts.labelId } };
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
            createdAt: string;
            updatedAt: string;
          }>;
        };
      };
    }>(query, { teamId: opts.teamId, filter });

    const issues = result.team?.issues?.nodes ?? [];
    core.info(`Found ${issues.length} matching issues`);

    return issues.map((i) => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      url: i.url,
      branchName: i.branchName,
      state: i.state.name,
    }));
  }

  // ---------------------------------------------------------------------------
  // 6. addOccurrence
  // ---------------------------------------------------------------------------

  async addOccurrence(issueId: string): Promise<void> {
    const date = new Date().toISOString().split("T")[0];
    core.info(`Adding occurrence to issue ${issueId} (${date})`);

    const commentMutation = `
      mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
        }
      }
    `;

    await this.request(commentMutation, {
      input: {
        issueId,
        body: `+1 detected on ${date}`,
      },
    });

    core.info(`Occurrence added to issue ${issueId}`);
  }

  // ---------------------------------------------------------------------------
  // 7. linkPr
  // ---------------------------------------------------------------------------

  async linkPr(
    issueId: string,
    prUrl: string,
    prNumber: number,
  ): Promise<void> {
    core.info(`Linking PR #${prNumber} to issue ${issueId}`);

    // Create attachment link
    const attachmentMutation = `
      mutation CreateAttachment($input: AttachmentCreateInput!) {
        attachmentCreate(input: $input) {
          success
          attachment {
            id
          }
        }
      }
    `;

    await this.request(attachmentMutation, {
      input: {
        issueId,
        url: prUrl,
        title: `GitHub PR #${prNumber}`,
      },
    });

    // Add comment
    const commentMutation = `
      mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
        }
      }
    `;

    await this.request(commentMutation, {
      input: {
        issueId,
        body: `**Pull Request Created**: [PR #${prNumber}](${prUrl})`,
      },
    });

    core.info(`PR #${prNumber} linked to issue ${issueId}`);
  }

  // ---------------------------------------------------------------------------
  // 8. listTriageHistory
  // ---------------------------------------------------------------------------

  async listTriageHistory(
    teamId: string,
    labelId: string,
    days: number = 30,
  ): Promise<TriageHistoryEntry[]> {
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    core.info(
      `Listing triage history for team ${teamId} (last ${days} days)`,
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
              state {
                name
                type
              }
              createdAt
              updatedAt
              labels {
                nodes {
                  name
                }
              }
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
            updatedAt: string;
            labels: { nodes: Array<{ name: string }> };
          }>;
        };
      };
    }>(query, { teamId, filter });

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

    core.info(`Found ${entries.length} triage history entries`);

    return entries;
  }

  // ---------------------------------------------------------------------------
  // 9. searchByFingerprint
  // ---------------------------------------------------------------------------

  async searchByFingerprint(
    teamId: string,
    errorPattern: string,
    opts?: { labelId?: string; service?: string },
  ): Promise<Issue[]> {
    core.info(
      `Searching by fingerprint: "${errorPattern}" in team ${teamId}`,
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
              state {
                name
                type
              }
            }
          }
        }
      }
    `;

    const filter: Record<string, unknown> = {};
    if (opts?.labelId) {
      filter.labels = { id: { eq: opts.labelId } };
    }
    // Only look at non-cancelled issues from last 90 days
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
    }>(query, { teamId, filter });

    const issues = result.team?.issues?.nodes ?? [];
    const pattern = errorPattern.toLowerCase();
    const service = opts?.service?.toLowerCase();

    // Search descriptions for fingerprint match
    const matches = issues.filter((issue) => {
      if (!issue.description) return false;
      const desc = issue.description.toLowerCase();

      // Check fingerprint block first
      const fpMatch = desc.match(/<!-- triage_fingerprint\n([\s\S]*?)-->/);
      if (fpMatch) {
        const fp = fpMatch[1];
        const hasErrorMatch = fp.includes(pattern);
        const hasServiceMatch = !service || fp.includes(service);
        if (hasErrorMatch && hasServiceMatch) return true;
      }

      // Fall back to searching the full description
      return desc.includes(pattern);
    });

    core.info(`Found ${matches.length} issues matching fingerprint`);

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
