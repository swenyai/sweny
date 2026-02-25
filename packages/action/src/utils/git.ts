import * as exec from "@actions/exec";
import * as core from "@actions/core";

export async function configureGit(): Promise<void> {
  await exec.exec("git", ["config", "user.name", "github-actions[bot]"]);
  await exec.exec("git", [
    "config",
    "user.email",
    "github-actions[bot]@users.noreply.github.com",
  ]);
}

export async function createBranch(branchName: string): Promise<void> {
  await exec.exec("git", ["checkout", "-b", branchName]);
  core.info(`Created branch: ${branchName}`);
}

export async function pushBranch(
  branchName: string,
  token: string,
  repository: string
): Promise<void> {
  await exec.exec("git", [
    "remote",
    "set-url",
    "origin",
    `https://x-access-token:${token}@github.com/${repository}.git`,
  ]);
  await exec.exec("git", ["push", "origin", branchName]);
  core.info(`Pushed branch: ${branchName}`);
}

export async function hasCommits(): Promise<boolean> {
  let output = "";
  await exec.exec("git", ["rev-list", "--count", "HEAD", "^origin/main"], {
    listeners: {
      stdout: (data) => {
        output += data.toString();
      },
    },
    ignoreReturnCode: true,
  });
  const count = parseInt(output.trim(), 10);
  return !isNaN(count) && count > 0;
}

export async function hasUncommittedChanges(): Promise<boolean> {
  let output = "";
  await exec.exec(
    "git",
    [
      "diff",
      "--name-only",
      "--",
      ".",
      ":!.github/datadog-analysis",
      ":!.github/workflows",
    ],
    {
      listeners: {
        stdout: (data) => {
          output += data.toString();
        },
      },
      ignoreReturnCode: true,
    }
  );
  let staged = "";
  await exec.exec(
    "git",
    [
      "diff",
      "--cached",
      "--name-only",
      "--",
      ".",
      ":!.github/datadog-analysis",
      ":!.github/workflows",
    ],
    {
      listeners: {
        stdout: (data) => {
          staged += data.toString();
        },
      },
      ignoreReturnCode: true,
    }
  );
  return output.trim().length > 0 || staged.trim().length > 0;
}

export async function stageAndCommit(message: string): Promise<void> {
  await exec.exec("git", [
    "add",
    "-A",
    "--",
    ".",
    ":!.github/datadog-analysis",
    ":!.github/workflows",
  ]);
  await exec.exec("git", ["commit", "-m", message]);
}

export async function getChangedFiles(): Promise<string[]> {
  let output = "";
  await exec.exec("git", ["diff", "--name-only", "origin/main..HEAD"], {
    listeners: {
      stdout: (data) => {
        output += data.toString();
      },
    },
    ignoreReturnCode: true,
  });
  return output.trim().split("\n").filter(Boolean);
}

/**
 * Reset workflow file changes to avoid permission issues on push.
 */
export async function resetWorkflowChanges(): Promise<void> {
  await exec.exec("git", ["checkout", "HEAD", "--", ".github/workflows/"], {
    ignoreReturnCode: true,
  });
}
