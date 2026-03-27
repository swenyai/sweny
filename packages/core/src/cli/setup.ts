/**
 * sweny setup <provider>
 *
 * Creates the standard SWEny label set in the configured issue tracker / source control
 * provider, then prints a config snippet with the resolved IDs ready to paste into
 * .sweny.yml or GitHub Actions secrets.
 */

import chalk from "chalk";
import type { Command } from "commander";

const LINEAR_API_URL = "https://api.linear.app/graphql";
const GITHUB_API_URL = "https://api.github.com";

// ── Standard label definitions ──────────────────────────────────────────────

interface LabelDef {
  name: string;
  color: string; // hex without #
  description: string;
  /** For Linear: if true, this label is a child of the `agent` group parent. */
  isWorkType?: boolean;
}

const SIGNAL_LABELS: LabelDef[] = [
  {
    name: "agent-needs-input",
    color: "CA8A04",
    description: "Agent hit a decision point — needs human clarification before it can proceed",
  },
  {
    name: "agent-error",
    color: "B91C1C",
    description: "Unexpected technical failure during agent execution — needs human investigation",
  },
  {
    name: "human-only",
    color: "6B7280",
    description: "Guard rail — automation must not touch this issue or PR",
  },
  {
    name: "needs-review",
    color: "0EA5E9",
    description: "PR opened by the agent and waiting for human review",
  },
];

const WORK_TYPE_LABELS: LabelDef[] = [
  {
    name: "triage",
    color: "EA580C",
    description: "Production log analysis and bug detection by the agent",
    isWorkType: true,
  },
  {
    name: "feature",
    color: "2563EB",
    description: "Feature implementation by the agent",
    isWorkType: true,
  },
  {
    name: "optimization",
    color: "059669",
    description: "Performance or code optimization by the agent",
    isWorkType: true,
  },
  {
    name: "research",
    color: "D97706",
    description: "Spike, investigation, or report by the agent — exploratory work without a direct code change",
    isWorkType: true,
  },
  {
    name: "support",
    color: "0891B2",
    description: "Work initiated from a support request by the agent",
    isWorkType: true,
  },
  {
    name: "spec",
    color: "BE185D",
    description: "Spec generation — agent converted non-technical input into a structured spec",
    isWorkType: true,
  },
  {
    name: "task",
    color: "78716C",
    description: "Open-ended prompt or generic work by the agent that does not fit another category",
    isWorkType: true,
  },
];

const AGENT_PARENT: LabelDef = {
  name: "agent",
  color: "7C3AED",
  description: "Parent group — marks all autonomous agent work",
};

const BUG_LABEL: LabelDef = {
  name: "bug",
  color: "DC2626",
  description: "A confirmed bug",
};

// ── Linear ───────────────────────────────────────────────────────────────────

interface LinearLabel {
  id: string;
  name: string;
  parent?: { id: string } | null;
}

async function linearRequest<T>(apiKey: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear API error: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`Linear GraphQL: ${body.errors.map((e) => e.message).join(", ")}`);
  return body.data as T;
}

async function listLinearLabels(apiKey: string, teamId: string): Promise<LinearLabel[]> {
  const data = await linearRequest<{ team: { labels: { nodes: LinearLabel[] } } }>(
    apiKey,
    `query($teamId: String!) {
      team(id: $teamId) {
        labels(first: 250) {
          nodes { id name parent { id } }
        }
      }
    }`,
    { teamId },
  );
  return data.team.labels.nodes;
}

async function createLinearLabel(
  apiKey: string,
  teamId: string,
  def: LabelDef,
  parentId?: string,
): Promise<LinearLabel> {
  const data = await linearRequest<{ issueLabelCreate: { issueLabel: LinearLabel; success: boolean } }>(
    apiKey,
    `mutation($input: IssueLabelCreateInput!) {
      issueLabelCreate(input: $input) {
        issueLabel { id name }
        success
      }
    }`,
    {
      input: {
        teamId,
        name: def.name,
        color: `#${def.color}`,
        description: def.description,
        ...(parentId ? { parentId } : {}),
        ...(def === AGENT_PARENT ? { isGroup: true } : {}),
      },
    },
  );
  if (!data.issueLabelCreate.success) throw new Error(`Failed to create Linear label "${def.name}"`);
  return data.issueLabelCreate.issueLabel;
}

export async function setupLinear(apiKey: string, teamId: string): Promise<void> {
  console.log(chalk.dim("\n  Fetching existing labels…\n"));

  const existing = await listLinearLabels(apiKey, teamId);
  const byName = new Map(existing.map((l) => [l.name.toLowerCase(), l]));

  const created: string[] = [];
  const skipped: string[] = [];

  // Helper: find or create
  async function ensure(def: LabelDef, parentId?: string): Promise<LinearLabel> {
    const found = byName.get(def.name.toLowerCase());
    if (found) {
      skipped.push(def.name);
      console.log(`  ${chalk.dim("–")} ${chalk.dim(def.name)} ${chalk.dim("(already exists)")}`);
      return found;
    }
    const label = await createLinearLabel(apiKey, teamId, def, parentId);
    byName.set(def.name.toLowerCase(), label);
    created.push(def.name);
    console.log(`  ${chalk.green("+")} ${chalk.bold(def.name)}`);
    return label;
  }

  // 1. agent group parent
  const agentLabel = await ensure(AGENT_PARENT);

  // 2. Work type labels (children of agent)
  const workTypeIds: Record<string, string> = {};
  for (const def of WORK_TYPE_LABELS) {
    const label = await ensure(def, agentLabel.id);
    workTypeIds[def.name] = label.id;
  }

  // 3. Signal labels (standalone)
  const signalIds: Record<string, string> = {};
  for (const def of SIGNAL_LABELS) {
    const label = await ensure(def);
    signalIds[def.name] = label.id;
  }

  // 4. Bug label (standalone, may already exist)
  const bugLabel = byName.get("bug") ?? (await ensure(BUG_LABEL));
  const bugId = bugLabel.id;

  // ── Print config snippet ─────────────────────────────────────────────────
  const triageId = workTypeIds["triage"] ?? byName.get("triage")?.id ?? "";

  console.log(`
${chalk.bold("  Done.")} ${created.length} created, ${skipped.length} already existed.

${chalk.bold("  Add these to your .sweny.yml:")}

${chalk.cyan(`  issue-tracker-provider: linear
  linear-team-id: ${teamId}
  linear-triage-label-id: ${triageId}
  linear-bug-label-id: ${bugId}
  issue-labels: ${agentLabel.id}`)}

${chalk.bold("  Or as environment variables / GitHub Actions secrets:")}

${chalk.cyan(`  LINEAR_TEAM_ID=${teamId}
  LINEAR_TRIAGE_LABEL_ID=${triageId}
  LINEAR_BUG_LABEL_ID=${bugId}
  SWENY_ISSUE_LABELS=${agentLabel.id}`)}

${chalk.dim("  Full label inventory:")}
${chalk.dim(`  agent               ${agentLabel.id}`)}
${Object.entries(workTypeIds)
  .map(([name, id]) => chalk.dim(`  ${name.padEnd(20)}${id}`))
  .join("\n")}
${Object.entries(signalIds)
  .map(([name, id]) => chalk.dim(`  ${name.padEnd(20)}${id}`))
  .join("\n")}
${bugId ? chalk.dim(`  bug                 ${bugId}`) : ""}
`);
}

// ── GitHub ────────────────────────────────────────────────────────────────────

interface GitHubLabel {
  name: string;
  color: string;
}

async function githubRequest<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${GITHUB_API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  // 201 Created and 200 OK are both success; 422 means label already exists
  if (!res.ok && res.status !== 422) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function listAllGithubLabels(token: string, repo: string): Promise<GitHubLabel[]> {
  const labels: GitHubLabel[] = [];
  let page = 1;
  while (true) {
    const batch = await githubRequest<GitHubLabel[]>(token, "GET", `/repos/${repo}/labels?per_page=100&page=${page}`);
    labels.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return labels;
}

export async function setupGithub(token: string, repo: string): Promise<void> {
  console.log(chalk.dim("\n  Fetching existing labels…\n"));

  const existing = await listAllGithubLabels(token, repo);
  const byName = new Set(existing.map((l) => l.name.toLowerCase()));

  const allLabels: LabelDef[] = [AGENT_PARENT, ...WORK_TYPE_LABELS, ...SIGNAL_LABELS, BUG_LABEL];

  const created: string[] = [];
  const skipped: string[] = [];

  for (const def of allLabels) {
    if (byName.has(def.name.toLowerCase())) {
      skipped.push(def.name);
      console.log(`  ${chalk.dim("–")} ${chalk.dim(def.name)} ${chalk.dim("(already exists)")}`);
      continue;
    }
    await githubRequest(token, "POST", `/repos/${repo}/labels`, {
      name: def.name,
      color: def.color,
      description: def.description,
    });
    created.push(def.name);
    console.log(`  ${chalk.green("+")} ${chalk.bold(def.name)}`);
  }

  console.log(`
${chalk.bold("  Done.")} ${created.length} created, ${skipped.length} already existed.

${chalk.bold("  Add these to your .sweny.yml:")}

${chalk.cyan(`  source-control-provider: github
  pr-labels: agent,triage,needs-review
  issue-labels: agent`)}

${chalk.dim("  GitHub labels are referenced by name — no UUIDs needed.")}
`);
}

// ── Command registration ───────────────────────────────────────────────────

export function registerSetupCommand(program: Command): void {
  const setupCmd = program
    .command("setup")
    .description("Create the standard SWEny label set in your issue tracker or source control provider");

  setupCmd
    .command("linear")
    .description("Create SWEny labels in a Linear workspace")
    .requiredOption("--team-id <id>", "Linear team ID", process.env.LINEAR_TEAM_ID)
    .action(async (opts: { teamId: string }) => {
      const apiKey = process.env.LINEAR_API_KEY;
      if (!apiKey) {
        console.error(chalk.red("\n  Missing: LINEAR_API_KEY environment variable\n"));
        process.exit(1);
      }
      if (!opts.teamId) {
        console.error(chalk.red("\n  Missing: --team-id or LINEAR_TEAM_ID\n"));
        process.exit(1);
      }
      console.log(chalk.bold(`\n  sweny setup linear  (team: ${opts.teamId})\n`));
      try {
        await setupLinear(apiKey, opts.teamId);
      } catch (err) {
        console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
        process.exit(1);
      }
    });

  setupCmd
    .command("github")
    .description("Create SWEny labels in a GitHub repository")
    .requiredOption("--repo <owner/repo>", "GitHub repository (e.g. my-org/my-repo)", process.env.GITHUB_REPOSITORY)
    .action(async (opts: { repo: string }) => {
      const token = process.env.GITHUB_TOKEN || process.env.BOT_TOKEN;
      if (!token) {
        console.error(chalk.red("\n  Missing: GITHUB_TOKEN environment variable\n"));
        process.exit(1);
      }
      if (!opts.repo) {
        console.error(chalk.red("\n  Missing: --repo or GITHUB_REPOSITORY\n"));
        process.exit(1);
      }
      console.log(chalk.bold(`\n  sweny setup github  (repo: ${opts.repo})\n`));
      try {
        await setupGithub(token, opts.repo);
      } catch (err) {
        console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
        process.exit(1);
      }
    });
}
