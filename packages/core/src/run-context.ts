/**
 * The run identity and job-summary writer every tool handler receives
 * (ToolContext.run, ToolContext.summary). Read from the operator's
 * environment through the startup snapshot, so neither tool input nor a
 * workspace `.env` can point them elsewhere. Skill-neutral: the executor
 * builds this once per run and hands the same object to every tool.
 *
 * Node only.
 */

import { workspaceRoot, writeFileNoFollow } from "./safe-file.js";
import { trustedEnvValue } from "./startup-env.js";
import type { ToolContext, ToolRunContext } from "./types.js";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const POSITIVE_INT = /^[1-9][0-9]{0,9}$/;

/** The pull request number the runner set: `PR_NUMBER` (the Action), else `GITHUB_REF` on a pull_request event. */
function pullRequestOf(env: NodeJS.ProcessEnv): number | undefined {
  const explicit = trustedEnvValue(env, "PR_NUMBER")?.trim();
  const fromRef = /^refs\/pull\/([1-9][0-9]{0,9})\/(?:merge|head)$/.exec(trustedEnvValue(env, "GITHUB_REF") ?? "")?.[1];
  const raw = explicit || fromRef;
  if (!raw || !POSITIVE_INT.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** This run's page: `<server>/<repo>/actions/runs/<id>`, only from a plain https server URL. */
export function runReceiptUrl(env: NodeJS.ProcessEnv): string | undefined {
  const repo = trustedEnvValue(env, "GITHUB_REPOSITORY");
  const run = trustedEnvValue(env, "GITHUB_RUN_ID");
  if (!repo || !REPO.test(repo) || !run || !POSITIVE_INT.test(run)) return undefined;
  try {
    const base = new URL(trustedEnvValue(env, "GITHUB_SERVER_URL") || "https://github.com");
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) return undefined;
    if (base.pathname !== "/") return undefined;
    return `${base.origin}/${repo}/actions/runs/${run}`;
  } catch {
    return undefined;
  }
}

/** Appends to the operator's `$GITHUB_STEP_SUMMARY`; undefined when it is not set. Never throws. */
export function summaryWriter(env: NodeJS.ProcessEnv): ((markdown: string) => void) | undefined {
  const file = trustedEnvValue(env, "GITHUB_STEP_SUMMARY");
  if (!file) return undefined;
  return (markdown: string) => {
    const line = String(markdown).replace(/\r/g, "").slice(0, 2000).trim();
    if (!line) return;
    try {
      // Never through a link, in case the path sits in the agent-writable workspace.
      writeFileNoFollow(file, `${line}\n\n`, { ...workspaceRoot(file), append: true, mkdirs: false, mode: 0o644 });
    } catch {
      // A summary line is a courtesy; it never fails a tool.
    }
  };
}

/** The `run` and `summary` fields of every ToolContext in this run. */
export function toolRunContext(workflowId: string, env: NodeJS.ProcessEnv): Pick<ToolContext, "run" | "summary"> {
  const repo = trustedEnvValue(env, "GITHUB_REPOSITORY");
  const pullRequest = pullRequestOf(env);
  const receiptUrl = runReceiptUrl(env);
  const run: ToolRunContext = {
    workflowId,
    ...(repo && REPO.test(repo) ? { repo } : {}),
    ...(pullRequest !== undefined ? { pullRequest } : {}),
    ...(receiptUrl ? { receiptUrl } : {}),
  };
  const summary = summaryWriter(env);
  return { run, ...(summary ? { summary } : {}) };
}
