import * as exec from "@actions/exec";

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
