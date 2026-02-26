import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SourceControlProvider, PullRequest, PrCreateOptions } from "./types.js";
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

async function ghApi(
  method: string,
  path: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
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
      await git([
        "remote", "set-url", "origin",
        `https://x-access-token:${token}@github.com/${owner}/${repo}.git`,
      ]);
      await git(["push", "origin", name]);
      log.info(`Pushed branch: ${name}`);
    },

    async hasChanges(): Promise<boolean> {
      const unstaged = await git(
        ["diff", "--name-only", "--", ".", ":!.github/datadog-analysis", ":!.github/workflows"],
        { ignoreReturnCode: true },
      );
      const staged = await git(
        ["diff", "--cached", "--name-only", "--", ".", ":!.github/datadog-analysis", ":!.github/workflows"],
        { ignoreReturnCode: true },
      );
      return unstaged.trim().length > 0 || staged.trim().length > 0;
    },

    async stageAndCommit(message: string): Promise<void> {
      await git(["add", "-A", "--", ".", ":!.github/datadog-analysis", ":!.github/workflows"]);
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
        await ghApi(
          "POST",
          `/repos/${owner}/${repo}/issues/${pr.number}/labels`,
          token,
          { labels: opts.labels },
        );
      }

      return { number: pr.number, url: pr.html_url, state: "open", title: opts.title };
    },

    async findExistingPr(searchTerm: string): Promise<PullRequest | null> {
      // Search open PRs
      const openPrs = (await ghApi(
        "GET",
        `/repos/${owner}/${repo}/pulls?state=open&per_page=20`,
        token,
      )) as { number: number; html_url: string; title: string; body: string | null }[];

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
  };
}
