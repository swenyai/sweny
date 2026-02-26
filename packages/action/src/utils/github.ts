import * as core from "@actions/core";
import * as exec from "@actions/exec";

/**
 * Dispatch a workflow to another repository (cross-repo handoff).
 */
export async function dispatchWorkflow(opts: {
  token: string;
  targetRepo: string;
  linearIssue: string;
  sourceRepo: string;
}): Promise<void> {
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
    `Dispatched workflow to ${opts.targetRepo} with linear_issue=${opts.linearIssue}`,
  );
}
