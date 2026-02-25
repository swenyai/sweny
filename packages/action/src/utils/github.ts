import * as github from "@actions/github";
import * as core from "@actions/core";
import * as exec from "@actions/exec";

interface PrCreateOptions {
  token: string;
  title: string;
  body: string;
  head: string;
  base?: string;
  labels?: string[];
}

interface PrInfo {
  number: number;
  url: string;
}

export async function createPullRequest(
  opts: PrCreateOptions
): Promise<PrInfo> {
  const octokit = github.getOctokit(opts.token);
  const { owner, repo } = github.context.repo;

  const pr = await octokit.rest.pulls.create({
    owner,
    repo,
    title: opts.title,
    head: opts.head,
    base: opts.base || "main",
    body: opts.body,
  });

  core.info(`Created PR #${pr.data.number}: ${pr.data.html_url}`);

  if (opts.labels && opts.labels.length > 0) {
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: pr.data.number,
      labels: opts.labels,
    });
  }

  return { number: pr.data.number, url: pr.data.html_url };
}

interface ExistingPr {
  found: boolean;
  url: string;
  state: string; // "open" | "merged" | "closed"
}

/**
 * Check for existing PRs matching a Linear issue identifier.
 */
export async function findExistingPr(
  token: string,
  issueIdentifier: string,
  skipMergedCheck: boolean
): Promise<ExistingPr> {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;

  // Search open PRs
  const openPrs = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "open",
    per_page: 20,
  });

  for (const pr of openPrs.data) {
    const text = `${pr.title} ${pr.body || ""}`;
    if (new RegExp(`\\b${issueIdentifier}\\b`, "i").test(text)) {
      core.info(`Found open PR with match: ${pr.html_url}`);
      return { found: true, url: pr.html_url, state: "open" };
    }
  }

  // Search merged PRs (unless skipping)
  if (!skipMergedCheck) {
    const closedPrs = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "closed",
      per_page: 20,
      sort: "updated",
      direction: "desc",
    });

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    for (const pr of closedPrs.data) {
      if (pr.merged_at && new Date(pr.merged_at) > cutoff) {
        const text = `${pr.title} ${pr.body || ""}`;
        if (new RegExp(`\\b${issueIdentifier}\\b`, "i").test(text)) {
          core.info(`Found merged PR with match: ${pr.html_url}`);
          return { found: true, url: pr.html_url, state: "merged" };
        }
      }
    }
  }

  return { found: false, url: "", state: "" };
}

/**
 * Dispatch a workflow to another repository (cross-repo handoff).
 */
export async function dispatchWorkflow(opts: {
  token: string;
  targetRepo: string;
  linearIssue: string;
  sourceRepo: string;
}): Promise<void> {
  // Use gh CLI for workflow dispatch since it's simpler than the API
  const args = [
    "workflow",
    "run",
    "SWEny Triage",
    "--repo",
    opts.targetRepo,
    "-f",
    `linear_issue=${opts.linearIssue}`,
    "-f",
    `dispatched_from=${opts.sourceRepo}`,
    "-f",
    "novelty_mode=false",
  ];

  await exec.exec("gh", args, {
    env: { ...process.env, GH_TOKEN: opts.token } as Record<string, string>,
  });

  core.info(
    `Dispatched workflow to ${opts.targetRepo} with linear_issue=${opts.linearIssue}`
  );
}
