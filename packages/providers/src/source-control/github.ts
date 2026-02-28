import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  SourceControlProvider,
  PullRequest,
  PrCreateOptions,
  PrListOptions,
  DispatchWorkflowOptions,
} from "./types.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";

const execFileAsync = promisify(execFile);

export interface GitHubSourceControlConfig {
  token: string;
  owner: string;
  repo: string;
  baseBranch?: string;
  logger?: Logger;
}

async function git(args: string[], opts?: { ignoreReturnCode?: boolean }): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args);
    return stdout;
  } catch (err: unknown) {
    if (opts?.ignoreReturnCode) return "";
    throw err;
  }
}

async function ghApi(method: string, path: string, token: string, body?: Record<string, unknown>): Promise<unknown> {
  const resp = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub API ${method} ${path} failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

export function github(config: GitHubSourceControlConfig): SourceControlProvider {
  const { token, owner, repo, baseBranch = "main" } = config;
  const log = config.logger ?? consoleLogger;

  return {
    async verifyAccess(): Promise<void> {
      await ghApi("GET", `/repos/${owner}/${repo}`, token);
      log.info(`Verified access to ${owner}/${repo}`);
    },

    async configureBotIdentity(): Promise<void> {
      await git(["config", "user.name", "github-actions[bot]"]);
      await git(["config", "user.email", "github-actions[bot]@users.noreply.github.com"]);
      log.debug("Configured git bot identity");
    },

    async createBranch(name: string): Promise<void> {
      await git(["checkout", "-b", name]);
      log.info(`Created branch: ${name}`);
    },

    async pushBranch(name: string): Promise<void> {
      await git(["remote", "set-url", "origin", `https://x-access-token:${token}@github.com/${owner}/${repo}.git`]);
      await git(["push", "origin", name]);
      log.info(`Pushed branch: ${name}`);
    },

    async hasChanges(): Promise<boolean> {
      const unstaged = await git(
        ["diff", "--name-only", "--", ".", ":!.github/triage-analysis", ":!.github/workflows"],
        { ignoreReturnCode: true },
      );
      const staged = await git(
        ["diff", "--cached", "--name-only", "--", ".", ":!.github/triage-analysis", ":!.github/workflows"],
        { ignoreReturnCode: true },
      );
      return unstaged.trim().length > 0 || staged.trim().length > 0;
    },

    async hasNewCommits(): Promise<boolean> {
      const output = await git(["rev-list", "--count", `HEAD`, `^origin/${baseBranch}`], { ignoreReturnCode: true });
      const count = parseInt(output.trim(), 10);
      return !isNaN(count) && count > 0;
    },

    async getChangedFiles(): Promise<string[]> {
      const output = await git(["diff", "--name-only", `origin/${baseBranch}..HEAD`], { ignoreReturnCode: true });
      return output.trim().split("\n").filter(Boolean);
    },

    async resetPaths(paths: string[]): Promise<void> {
      for (const p of paths) {
        await git(["checkout", "HEAD", "--", p], { ignoreReturnCode: true });
      }
      log.debug(`Reset paths: ${paths.join(", ")}`);
    },

    async stageAndCommit(message: string): Promise<void> {
      await git(["add", "-A", "--", ".", ":!.github/triage-analysis", ":!.github/workflows"]);
      await git(["commit", "-m", message]);
    },

    async createPullRequest(opts: PrCreateOptions): Promise<PullRequest> {
      const body: Record<string, unknown> = {
        title: opts.title,
        head: opts.head,
        base: opts.base || baseBranch,
        body: opts.body,
      };

      const pr = (await ghApi("POST", `/repos/${owner}/${repo}/pulls`, token, body)) as {
        number: number;
        html_url: string;
        state: string;
      };
      log.info(`Created PR #${pr.number}: ${pr.html_url}`);

      if (opts.labels && opts.labels.length > 0) {
        await ghApi("POST", `/repos/${owner}/${repo}/issues/${pr.number}/labels`, token, { labels: opts.labels });
      }

      return { number: pr.number, url: pr.html_url, state: "open", title: opts.title };
    },

    async listPullRequests(opts?: PrListOptions): Promise<PullRequest[]> {
      const state = opts?.state ?? "open";
      const limit = opts?.limit ?? 30;
      const params = new URLSearchParams({
        state: state === "merged" ? "closed" : state,
        per_page: String(limit),
        sort: "updated",
        direction: "desc",
      });

      const prs = (await ghApi("GET", `/repos/${owner}/${repo}/pulls?${params}`, token)) as {
        number: number;
        html_url: string;
        title: string;
        state: string;
        merged_at: string | null;
        closed_at: string | null;
        labels: { name: string }[];
      }[];

      const labelFilter = opts?.labels?.length ? new Set(opts.labels.map((l) => l.toLowerCase())) : null;

      const results: PullRequest[] = [];
      for (const pr of prs) {
        // Determine normalized state
        const prState: PullRequest["state"] = pr.merged_at ? "merged" : pr.state === "open" ? "open" : "closed";

        // Filter by requested state (handle "merged" vs "closed")
        if (state === "merged" && !pr.merged_at) continue;

        // Filter by labels
        if (labelFilter) {
          const prLabels = pr.labels.map((l) => l.name.toLowerCase());
          if (!prLabels.some((l) => labelFilter.has(l))) continue;
        }

        results.push({
          number: pr.number,
          url: pr.html_url,
          state: prState,
          title: pr.title,
          mergedAt: pr.merged_at,
          closedAt: pr.closed_at,
        });
      }

      return results;
    },

    async findExistingPr(searchTerm: string): Promise<PullRequest | null> {
      // Search open PRs
      const openPrs = (await ghApi("GET", `/repos/${owner}/${repo}/pulls?state=open&per_page=20`, token)) as {
        number: number;
        html_url: string;
        title: string;
        body: string | null;
      }[];

      for (const pr of openPrs) {
        const text = `${pr.title} ${pr.body || ""}`;
        if (new RegExp(`\\b${searchTerm}\\b`, "i").test(text)) {
          log.info(`Found open PR with match: ${pr.html_url}`);
          return { number: pr.number, url: pr.html_url, state: "open", title: pr.title };
        }
      }

      // Search recently merged PRs (last 30 days)
      const closedPrs = (await ghApi(
        "GET",
        `/repos/${owner}/${repo}/pulls?state=closed&per_page=20&sort=updated&direction=desc`,
        token,
      )) as {
        number: number;
        html_url: string;
        title: string;
        body: string | null;
        merged_at: string | null;
      }[];

      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      for (const pr of closedPrs) {
        if (pr.merged_at && new Date(pr.merged_at) > cutoff) {
          const text = `${pr.title} ${pr.body || ""}`;
          if (new RegExp(`\\b${searchTerm}\\b`, "i").test(text)) {
            log.info(`Found merged PR with match: ${pr.html_url}`);
            return { number: pr.number, url: pr.html_url, state: "merged", title: pr.title };
          }
        }
      }

      return null;
    },

    async dispatchWorkflow(opts: DispatchWorkflowOptions): Promise<void> {
      const targetParts = opts.targetRepo.split("/");
      const targetOwner = targetParts[0] ?? owner;
      const targetRepoName = targetParts[1] ?? opts.targetRepo;

      await ghApi(
        "POST",
        `/repos/${targetOwner}/${targetRepoName}/actions/workflows/${encodeURIComponent(opts.workflow)}/dispatches`,
        token,
        { ref: baseBranch, inputs: opts.inputs ?? {} },
      );
      log.info(`Dispatched workflow "${opts.workflow}" to ${opts.targetRepo}`);
    },
  };
}
