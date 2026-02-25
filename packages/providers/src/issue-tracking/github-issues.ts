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
} from "./types.js";

export const githubIssuesConfigSchema = z.object({
  token: z.string().min(1, "GitHub token is required"),
  owner: z.string().min(1, "Repository owner is required"),
  repo: z.string().min(1, "Repository name is required"),
  logger: z.custom<Logger>().optional(),
});

export type GitHubIssuesConfig = z.infer<typeof githubIssuesConfigSchema>;

export function githubIssues(
  config: GitHubIssuesConfig,
): IssueTrackingProvider & PrLinkCapable {
  const parsed = githubIssuesConfigSchema.parse(config);
  return new GitHubIssuesProvider(parsed);
}

class GitHubIssuesProvider implements IssueTrackingProvider, PrLinkCapable {
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly log: Logger;

  constructor(config: GitHubIssuesConfig) {
    this.token = config.token;
    this.owner = config.owner;
    this.repo = config.repo;
    this.log = config.logger ?? consoleLogger;
  }

  private async request<T>(
    path: string,
    opts?: { method?: string; body?: unknown },
  ): Promise<T> {
    const url = `https://api.github.com${path}`;
    const response = await fetch(url, {
      method: opts?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as T;
  }

  async verifyAccess(): Promise<void> {
    this.log.info(`Verifying GitHub access (${this.owner}/${this.repo})`);

    await this.request(`/repos/${this.owner}/${this.repo}`);

    this.log.info("GitHub API access verified");
  }

  async createIssue(opts: IssueCreateOptions): Promise<Issue> {
    this.log.info(`Creating GitHub issue: ${opts.title}`);

    const body: Record<string, unknown> = {
      title: opts.title,
    };
    if (opts.description) body.body = opts.description;
    if (opts.labels && opts.labels.length > 0) body.labels = opts.labels;

    const result = await this.request<{
      id: number;
      number: number;
      title: string;
      html_url: string;
      state: string;
    }>(`/repos/${this.owner}/${this.repo}/issues`, {
      method: "POST",
      body,
    });

    const identifier = `#${result.number}`;
    this.log.info(`Created issue ${identifier} (${result.html_url})`);

    return {
      id: String(result.id),
      identifier,
      title: result.title,
      url: result.html_url,
      branchName: `fix/${result.number}`,
      state: result.state,
    };
  }

  async getIssue(identifier: string): Promise<Issue> {
    const issueNumber = identifier.replace(/^#/, "");
    this.log.info(`Fetching GitHub issue ${identifier}`);

    const result = await this.request<{
      id: number;
      number: number;
      title: string;
      html_url: string;
      state: string;
    }>(`/repos/${this.owner}/${this.repo}/issues/${issueNumber}`);

    return {
      id: String(result.id),
      identifier: `#${result.number}`,
      title: result.title,
      url: result.html_url,
      branchName: `fix/${result.number}`,
      state: result.state,
    };
  }

  async updateIssue(
    issueId: string,
    opts: IssueUpdateOptions,
  ): Promise<void> {
    this.log.info(`Updating GitHub issue ${issueId}`);

    // GitHub Issues uses issue number, not internal ID
    // issueId here is expected to be the issue number
    const body: Record<string, unknown> = {};
    if (opts.stateId) body.state = opts.stateId; // "open" or "closed"
    if (opts.description) body.body = opts.description;

    if (Object.keys(body).length > 0) {
      await this.request(`/repos/${this.owner}/${this.repo}/issues/${issueId}`, {
        method: "PATCH",
        body,
      });
    }

    if (opts.comment) {
      await this.addComment(issueId, opts.comment);
    }
  }

  async searchIssues(opts: IssueSearchOptions): Promise<Issue[]> {
    this.log.info(`Searching GitHub issues: "${opts.query}"`);

    const q = [
      opts.query,
      `repo:${this.owner}/${this.repo}`,
      "is:issue",
      ...(opts.states?.map((s) => `is:${s}`) ?? ["is:open"]),
      ...(opts.labels?.map((l) => `label:"${l}"`) ?? []),
    ].join(" ");

    const result = await this.request<{
      items: Array<{
        id: number;
        number: number;
        title: string;
        html_url: string;
        state: string;
      }>;
    }>(`/search/issues?q=${encodeURIComponent(q)}&per_page=10`);

    this.log.info(`Found ${result.items.length} matching issues`);

    return result.items.map((i) => ({
      id: String(i.id),
      identifier: `#${i.number}`,
      title: i.title,
      url: i.html_url,
      branchName: `fix/${i.number}`,
      state: i.state,
    }));
  }

  async addComment(issueId: string, body: string): Promise<void> {
    await this.request(
      `/repos/${this.owner}/${this.repo}/issues/${issueId}/comments`,
      { method: "POST", body: { body } },
    );
    this.log.info(`Comment added to issue ${issueId}`);
  }

  async linkPr(
    issueId: string,
    prUrl: string,
    prNumber: number,
  ): Promise<void> {
    this.log.info(`Linking PR #${prNumber} to issue #${issueId}`);

    await this.addComment(
      issueId,
      `**Pull Request Created**: [PR #${prNumber}](${prUrl})`,
    );
  }
}
