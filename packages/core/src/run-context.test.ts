import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runReceiptUrl, summaryWriter, toolRunContext } from "./run-context.js";
import { markWorkspaceEnv, unmarkWorkspaceEnv } from "./startup-env.js";

const dirs: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-run-context-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  unmarkWorkspaceEnv("PR_NUMBER");
  unmarkWorkspaceEnv("GITHUB_REPOSITORY");
});

describe("toolRunContext", () => {
  it("identifies the run's repo and PR from the runner's env", () => {
    const { run } = toolRunContext("review", {
      GITHUB_REPOSITORY: "o/r",
      PR_NUMBER: "12",
      GITHUB_RUN_ID: "99",
    });
    expect(run).toEqual({
      workflowId: "review",
      repo: "o/r",
      pullRequest: 12,
      receiptUrl: "https://github.com/o/r/actions/runs/99",
    });
  });

  it("falls back to GITHUB_REF on a pull_request event", () => {
    expect(toolRunContext("w", { GITHUB_REPOSITORY: "o/r", GITHUB_REF: "refs/pull/7/merge" }).run?.pullRequest).toBe(7);
    expect(toolRunContext("w", { GITHUB_REPOSITORY: "o/r", GITHUB_REF: "refs/heads/main" }).run?.pullRequest).toBe(
      undefined,
    );
  });

  it("ignores malformed values", () => {
    for (const PR_NUMBER of ["0", "-1", "3; rm -rf /", "1e3", "99999999999999"]) {
      expect(toolRunContext("w", { GITHUB_REPOSITORY: "o/r", PR_NUMBER }).run?.pullRequest).toBe(undefined);
    }
    expect(toolRunContext("w", { GITHUB_REPOSITORY: "o/r/../x", PR_NUMBER: "1" }).run?.repo).toBe(undefined);
  });

  it("never takes the repo or PR from a value the workspace .env introduced", () => {
    markWorkspaceEnv("PR_NUMBER");
    markWorkspaceEnv("GITHUB_REPOSITORY");
    const { run } = toolRunContext("w", { GITHUB_REPOSITORY: "attacker/r", PR_NUMBER: "424242" });
    expect(run?.repo).not.toBe("attacker/r");
    expect(run?.pullRequest).not.toBe(424242);
  });

  it("is only the workflow id off CI", () => {
    expect(toolRunContext("w", {})).toEqual({ run: { workflowId: "w" } });
  });
});

describe("runReceiptUrl", () => {
  it("links to the run on github.com or the operator's GHES server", () => {
    expect(runReceiptUrl({ GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "123" })).toBe(
      "https://github.com/o/r/actions/runs/123",
    );
    expect(
      runReceiptUrl({ GITHUB_SERVER_URL: "https://ghe.test", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "123" }),
    ).toBe("https://ghe.test/o/r/actions/runs/123");
  });

  it("refuses anything but a plain https server and numeric run id", () => {
    for (const env of [
      { GITHUB_SERVER_URL: "https://user:pw@host", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "1" },
      { GITHUB_SERVER_URL: "http://host", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "1" },
      { GITHUB_SERVER_URL: "https://host/x?y", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "1" },
      { GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "1)" },
      { GITHUB_REPOSITORY: "o/r" },
    ]) {
      expect(runReceiptUrl(env)).toBe(undefined);
    }
  });
});

describe("summaryWriter", () => {
  it("appends a line to the operator's step summary", () => {
    const file = path.join(tmp(), "summary.md");
    fs.writeFileSync(file, "existing\n");
    const write = summaryWriter({ GITHUB_STEP_SUMMARY: file });
    write!("**SWEny w**: skipped.\r");
    expect(fs.readFileSync(file, "utf8")).toBe("existing\n**SWEny w**: skipped.\n\n");
  });

  it("is absent without GITHUB_STEP_SUMMARY", () => {
    expect(summaryWriter({})).toBe(undefined);
    expect(toolRunContext("w", {}).summary).toBe(undefined);
  });

  it("never follows a link and never throws", () => {
    const dir = tmp();
    const target = path.join(dir, "target");
    const link = path.join(dir, "summary.md");
    fs.writeFileSync(target, "untouched");
    fs.symlinkSync(target, link);
    expect(() => summaryWriter({ GITHUB_STEP_SUMMARY: link })!("line")).not.toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("untouched");
    expect(() => summaryWriter({ GITHUB_STEP_SUMMARY: "/dev/null/x/s.md" })!("line")).not.toThrow();
  });
});
