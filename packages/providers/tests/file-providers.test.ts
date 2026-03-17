import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoist mock functions so they are available when vi.mock() factory runs ──
const { mockMkdirSync, mockWriteFileSync, mockReadFileSync, mockReaddirSync, mockExecFileSync } = vi.hoisted(() => ({
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockExecFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
}));

vi.mock("node:child_process", () => ({
  execFileSync: mockExecFileSync,
}));

import { fileNotification, fileNotificationConfigSchema } from "../src/notification/file.js";
import { fileIssueTracking, fileIssueTrackingConfigSchema } from "../src/issue-tracking/file.js";
import { fileSourceControl, fileSourceControlConfigSchema } from "../src/source-control/file.js";

const silentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn() };

// =============================================================================
// File Notification
// =============================================================================

describe("fileNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => vi.restoreAllMocks());

  describe("config validation", () => {
    it("rejects empty outputDir", () => {
      const result = fileNotificationConfigSchema.safeParse({ outputDir: "" });
      expect(result.success).toBe(false);
    });

    it("accepts valid outputDir", () => {
      const result = fileNotificationConfigSchema.safeParse({ outputDir: "/tmp/out" });
      expect(result.success).toBe(true);
    });
  });

  describe("send()", () => {
    it("calls mkdirSync with notifications subdir and recursive: true", async () => {
      const provider = fileNotification({ outputDir: "/tmp/out", logger: silentLogger });
      await provider.send({ title: "Test", body: "body text" });

      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining("notifications"), { recursive: true });
    });

    it("calls writeFileSync with a path ending in .md", async () => {
      const provider = fileNotification({ outputDir: "/tmp/out", logger: silentLogger });
      await provider.send({ title: "Test", body: "body text" });

      expect(mockWriteFileSync).toHaveBeenCalledWith(expect.stringMatching(/\.md$/), expect.any(String), "utf-8");
    });

    it("written content includes custom title as H1 heading", async () => {
      const provider = fileNotification({ outputDir: "/tmp/out", logger: silentLogger });
      await provider.send({ title: "My Custom Title", body: "body text" });

      const [, content] = mockWriteFileSync.mock.calls[0];
      expect(content).toContain("# My Custom Title");
    });

    it("uses default title 'SWEny Triage Summary' when title is not provided", async () => {
      const provider = fileNotification({ outputDir: "/tmp/out", logger: silentLogger });
      await provider.send({ body: "body text" } as never);

      const [, content] = mockWriteFileSync.mock.calls[0];
      expect(content).toContain("# SWEny Triage Summary");
    });

    it("includes status label from STATUS_EMOJI when payload.status is set", async () => {
      const provider = fileNotification({ outputDir: "/tmp/out", logger: silentLogger });
      await provider.send({ title: "T", body: "b", status: "success" });

      const [, content] = mockWriteFileSync.mock.calls[0];
      expect(content).toContain("SUCCESS");
    });

    it("includes fields as markdown table when payload.fields provided", async () => {
      const provider = fileNotification({ outputDir: "/tmp/out", logger: silentLogger });
      await provider.send({
        title: "T",
        body: "b",
        fields: [{ label: "Repo", value: "acme/app" }],
      });

      const [, content] = mockWriteFileSync.mock.calls[0];
      expect(content).toContain("| Field | Value |");
      expect(content).toContain("| Repo | acme/app |");
    });

    it("includes links section when payload.links provided", async () => {
      const provider = fileNotification({ outputDir: "/tmp/out", logger: silentLogger });
      await provider.send({
        title: "T",
        body: "b",
        links: [{ label: "PR", url: "https://example.com/pr/1" }],
      });

      const [, content] = mockWriteFileSync.mock.calls[0];
      expect(content).toContain("## Links");
      expect(content).toContain("[PR](https://example.com/pr/1)");
    });

    it("includes section content when payload.sections provided", async () => {
      const provider = fileNotification({ outputDir: "/tmp/out", logger: silentLogger });
      await provider.send({
        title: "T",
        body: "b",
        sections: [{ title: "Details", content: "Some detail content" }],
      });

      const [, content] = mockWriteFileSync.mock.calls[0];
      expect(content).toContain("## Details");
      expect(content).toContain("Some detail content");
    });
  });
});

// =============================================================================
// File Issue Tracking
// =============================================================================

describe("fileIssueTracking", () => {
  const outputDir = "/tmp/issues-test";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => vi.restoreAllMocks());

  describe("config validation", () => {
    it("rejects missing outputDir", () => {
      const result = fileIssueTrackingConfigSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects empty outputDir", () => {
      const result = fileIssueTrackingConfigSchema.safeParse({ outputDir: "" });
      expect(result.success).toBe(false);
    });

    it("accepts valid outputDir", () => {
      const result = fileIssueTrackingConfigSchema.safeParse({ outputDir: "/tmp/out" });
      expect(result.success).toBe(true);
    });
  });

  describe("createIssue()", () => {
    it("reads state, writes state and issue md file, returns Issue with id/url/title", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const provider = fileIssueTracking({ outputDir, logger: silentLogger });
      const issue = await provider.createIssue({ title: "Bug: crash on startup" });

      expect(issue.id).toBe("local-1");
      expect(issue.title).toBe("Bug: crash on startup");
      expect(issue.identifier).toBe("LOCAL-1");
      expect(issue.url).toContain("LOCAL-1.md");

      // state.json written + issue markdown written
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
    });

    it("increments issue number on successive creates using persisted state", async () => {
      let callCount = 0;
      mockReadFileSync.mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error("ENOENT"); // first createIssue: no state
        // second createIssue: returns state with nextIssueNumber=2
        return JSON.stringify({
          nextIssueNumber: 2,
          issues: [
            {
              id: "local-1",
              identifier: "LOCAL-1",
              number: 1,
              title: "First",
              state: "open",
              description: "",
              labels: [],
              priority: 2,
              branchName: "local-1-triage-fix",
              createdAt: new Date().toISOString(),
              comments: [],
            },
          ],
        });
      });

      const provider = fileIssueTracking({ outputDir, logger: silentLogger });
      await provider.createIssue({ title: "First" });
      const issue2 = await provider.createIssue({ title: "Second" });
      expect(issue2.id).toBe("local-2");
    });
  });

  describe("getIssue()", () => {
    it("reads issue record from state and returns correct data", async () => {
      const state = {
        nextIssueNumber: 2,
        issues: [
          {
            id: "local-1",
            identifier: "LOCAL-1",
            number: 1,
            title: "My Issue",
            state: "open",
            description: "desc",
            labels: [],
            priority: 2,
            branchName: "local-1-triage-fix",
            createdAt: new Date().toISOString(),
            comments: [],
          },
        ],
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(state));

      const provider = fileIssueTracking({ outputDir, logger: silentLogger });
      const issue = await provider.getIssue("LOCAL-1");

      expect(issue.title).toBe("My Issue");
      expect(issue.id).toBe("local-1");
    });

    it("throws when issue is not found", async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ nextIssueNumber: 1, issues: [] }));

      const provider = fileIssueTracking({ outputDir, logger: silentLogger });
      await expect(provider.getIssue("LOCAL-999")).rejects.toThrow("Issue not found");
    });
  });

  describe("updateIssue()", () => {
    it("updates state field and rewrites files", async () => {
      const state = {
        nextIssueNumber: 2,
        issues: [
          {
            id: "local-1",
            identifier: "LOCAL-1",
            number: 1,
            title: "My Issue",
            state: "open",
            description: "old desc",
            labels: [],
            priority: 2,
            branchName: "local-1-triage-fix",
            createdAt: new Date().toISOString(),
            comments: [],
          },
        ],
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(state));

      const provider = fileIssueTracking({ outputDir, logger: silentLogger });
      await provider.updateIssue("local-1", { stateId: "in_progress", description: "new desc" });

      // state.json + issue markdown rewritten
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
      const stateWriteCall = mockWriteFileSync.mock.calls[0];
      const writtenState = JSON.parse(stateWriteCall[1] as string);
      const updatedRec = writtenState.issues[0];
      expect(updatedRec.state).toBe("in_progress");
      expect(updatedRec.description).toBe("new desc");
    });

    it("adds comment when comment option provided", async () => {
      const state = {
        nextIssueNumber: 2,
        issues: [
          {
            id: "local-1",
            identifier: "LOCAL-1",
            number: 1,
            title: "Issue",
            state: "open",
            description: "",
            labels: [],
            priority: 2,
            branchName: "local-1-triage-fix",
            createdAt: new Date().toISOString(),
            comments: [],
          },
        ],
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(state));

      const provider = fileIssueTracking({ outputDir, logger: silentLogger });
      await provider.updateIssue("local-1", { comment: "Fixed in PR #42" });

      const stateWriteCall = mockWriteFileSync.mock.calls[0];
      const writtenState = JSON.parse(stateWriteCall[1] as string);
      expect(writtenState.issues[0].comments).toContain("Fixed in PR #42");
    });
  });

  describe("searchIssues()", () => {
    it("returns matching issues by title", async () => {
      const state = {
        nextIssueNumber: 3,
        issues: [
          {
            id: "local-1",
            identifier: "LOCAL-1",
            number: 1,
            title: "crash on login",
            state: "open",
            description: "",
            labels: [],
            priority: 2,
            branchName: "b",
            createdAt: new Date().toISOString(),
            comments: [],
          },
          {
            id: "local-2",
            identifier: "LOCAL-2",
            number: 2,
            title: "slow response",
            state: "open",
            description: "",
            labels: [],
            priority: 2,
            branchName: "b",
            createdAt: new Date().toISOString(),
            comments: [],
          },
        ],
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(state));

      const provider = fileIssueTracking({ outputDir, logger: silentLogger });
      const results = await provider.searchIssues({ query: "crash" });
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("crash on login");
    });

    it("returns empty array when no match", async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ nextIssueNumber: 1, issues: [] }));

      const provider = fileIssueTracking({ outputDir, logger: silentLogger });
      const results = await provider.searchIssues({ query: "nonexistent" });
      expect(results).toEqual([]);
    });
  });
});

// =============================================================================
// File Source Control
// =============================================================================

describe("fileSourceControl", () => {
  const outputDir = "/tmp/sc-test";

  beforeEach(() => {
    vi.clearAllMocks();
    // detectGit() runs in constructor — default to not-in-git-repo (throw on the detectGit call)
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        throw new Error("not a git repo");
      }
      return "";
    });
  });

  afterEach(() => vi.restoreAllMocks());

  describe("config validation", () => {
    it("rejects missing outputDir", () => {
      const result = fileSourceControlConfigSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects empty outputDir", () => {
      const result = fileSourceControlConfigSchema.safeParse({ outputDir: "" });
      expect(result.success).toBe(false);
    });

    it("accepts valid config with default baseBranch", () => {
      const result = fileSourceControlConfigSchema.safeParse({ outputDir: "/tmp/out" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.baseBranch).toBe("main");
      }
    });
  });

  describe("createBranch()", () => {
    it("calls git checkout -b when inside a git repo", async () => {
      // Override: detectGit succeeds, all other git commands succeed too
      mockExecFileSync.mockImplementation(() => "");

      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await provider.createBranch("feature/my-branch");

      // execFileSync is called as (cmd, args, opts) — check args contain the checkout args
      const argLists = mockExecFileSync.mock.calls.map((c) => c[1] as string[]);
      expect(
        argLists.some((args) => args.includes("checkout") && args.includes("-b") && args.includes("feature/my-branch")),
      ).toBe(true);
    });

    it("skips branch creation when not in a git repo", async () => {
      // beforeEach already makes detectGit throw
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await provider.createBranch("feature/my-branch");

      const argLists = mockExecFileSync.mock.calls.map((c) => c[1] as string[]);
      expect(argLists.every((args) => !args.includes("checkout") || !args.includes("-b"))).toBe(true);
    });
  });

  describe("createPullRequest()", () => {
    it("writes PR file to outputDir/prs/ and returns PullRequest object", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      const pr = await provider.createPullRequest({
        title: "Fix: resolve crash",
        body: "This fixes the crash.",
        head: "feature/fix-crash",
      });

      expect(pr.number).toBe(1);
      expect(pr.title).toBe("Fix: resolve crash");
      expect(pr.state).toBe("open");
      expect(pr.url).toContain("pr-1.md");

      // state.json + PR markdown written
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
      const prMdCall = mockWriteFileSync.mock.calls[1];
      expect(prMdCall[0]).toMatch(/pr-1\.md$/);
      expect(prMdCall[1]).toContain("# PR #1: Fix: resolve crash");
    });
  });

  describe("findExistingPr()", () => {
    it("returns null when no PRs match the search term", async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ nextPrNumber: 1, prs: [] }));

      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      const result = await provider.findExistingPr("nonexistent");
      expect(result).toBeNull();
    });

    it("returns matching PR when title contains the search term", async () => {
      const state = {
        nextPrNumber: 2,
        prs: [
          {
            number: 1,
            title: "Fix: crash on startup",
            state: "open",
            url: "file:///tmp/sc-test/prs/pr-1.md",
            head: "fix/crash",
            base: "main",
            labels: [],
            createdAt: new Date().toISOString(),
          },
        ],
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(state));

      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      const result = await provider.findExistingPr("crash on startup");
      expect(result).not.toBeNull();
      expect(result?.number).toBe(1);
      expect(result?.title).toBe("Fix: crash on startup");
    });

    it("search is case-insensitive", async () => {
      const state = {
        nextPrNumber: 2,
        prs: [
          {
            number: 1,
            title: "Fix: Memory Leak in Worker",
            state: "open",
            url: "file:///tmp/sc-test/prs/pr-1.md",
            head: "fix/memory",
            base: "main",
            labels: [],
            createdAt: new Date().toISOString(),
          },
        ],
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(state));

      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      const result = await provider.findExistingPr("memory leak");
      expect(result?.number).toBe(1);
    });
  });

  describe("verifyAccess()", () => {
    it("creates prsDir recursively", async () => {
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await provider.verifyAccess();
      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining("prs"), { recursive: true });
    });
  });

  describe("configureBotIdentity()", () => {
    it("configures git user when in a git repo", async () => {
      mockExecFileSync.mockImplementation(() => "");
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await provider.configureBotIdentity();

      const argLists = mockExecFileSync.mock.calls.map((c) => c[1] as string[]);
      expect(argLists.some((a) => a.includes("config") && a.includes("user.name") && a.includes("sweny-bot"))).toBe(
        true,
      );
      expect(argLists.some((a) => a.includes("config") && a.includes("user.email"))).toBe(true);
    });

    it("skips configuration when not in a git repo", async () => {
      // beforeEach makes detectGit throw → inGitRepo = false
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await provider.configureBotIdentity();

      const argLists = mockExecFileSync.mock.calls.map((c) => c[1] as string[]);
      expect(argLists.some((a) => a.includes("config"))).toBe(false);
    });
  });

  describe("pushBranch()", () => {
    it("logs skip and does not call git push", async () => {
      // Use git-enabled provider
      mockExecFileSync.mockImplementation(() => "");
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await provider.pushBranch("feature/test");

      const argLists = mockExecFileSync.mock.calls.map((c) => c[1] as string[]);
      expect(argLists.every((a) => !a.includes("push"))).toBe(true);
    });
  });

  describe("hasChanges()", () => {
    it("returns true when git status --porcelain has output", async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === "status" && args[1] === "--porcelain") return " M src/file.ts";
        return "";
      });
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      expect(await provider.hasChanges()).toBe(true);
    });

    it("returns false when git status --porcelain is empty", async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === "status" && args[1] === "--porcelain") return "";
        return "";
      });
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      expect(await provider.hasChanges()).toBe(false);
    });

    it("returns false when not in a git repo", async () => {
      // beforeEach makes detectGit throw → inGitRepo = false
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      expect(await provider.hasChanges()).toBe(false);
    });
  });

  describe("hasNewCommits()", () => {
    it("returns true when there are commits ahead of base branch", async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === "rev-list" && args[1] === "--count") return "3";
        return "";
      });
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      expect(await provider.hasNewCommits()).toBe(true);
    });

    it("returns false when count is 0", async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === "rev-list" && args[1] === "--count") return "0";
        return "";
      });
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      expect(await provider.hasNewCommits()).toBe(false);
    });

    it("returns false when rev-list throws (no upstream)", async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === "rev-list") throw new Error("unknown revision");
        return "";
      });
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      expect(await provider.hasNewCommits()).toBe(false);
    });

    it("returns false when not in a git repo", async () => {
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      expect(await provider.hasNewCommits()).toBe(false);
    });
  });

  describe("getChangedFiles()", () => {
    it("returns list of changed files", async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === "diff" && args[1] === "--name-only") return "src/a.ts\nsrc/b.ts";
        return "";
      });
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      const files = await provider.getChangedFiles();
      expect(files).toEqual(["src/a.ts", "src/b.ts"]);
    });

    it("returns empty array when diff output is empty", async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === "diff") return "";
        return "";
      });
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      const files = await provider.getChangedFiles();
      expect(files).toEqual([]);
    });

    it("returns empty array when not in a git repo", async () => {
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      const files = await provider.getChangedFiles();
      expect(files).toEqual([]);
    });

    it("returns empty array when git diff throws", async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === "diff") throw new Error("fatal: not a git repo");
        return "";
      });
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      const files = await provider.getChangedFiles();
      expect(files).toEqual([]);
    });
  });

  describe("resetPaths()", () => {
    it("calls git checkout HEAD -- for each path", async () => {
      mockExecFileSync.mockImplementation(() => "");
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await provider.resetPaths([".github/workflows/", "src/secret.ts"]);

      const argLists = mockExecFileSync.mock.calls.map((c) => c[1] as string[]);
      expect(
        argLists.some((a) => a.includes("checkout") && a.includes("HEAD") && a.includes(".github/workflows/")),
      ).toBe(true);
      expect(argLists.some((a) => a.includes("checkout") && a.includes("HEAD") && a.includes("src/secret.ts"))).toBe(
        true,
      );
    });

    it("does not throw when a path does not exist (ignores per-path errors)", async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args.includes("missing-path")) throw new Error("pathspec did not match");
        return "";
      });
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await expect(provider.resetPaths(["missing-path"])).resolves.toBeUndefined();
    });

    it("does nothing when not in a git repo", async () => {
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await provider.resetPaths(["src/foo.ts"]);

      const argLists = mockExecFileSync.mock.calls.map((c) => c[1] as string[]);
      expect(argLists.every((a) => !a.includes("checkout"))).toBe(true);
    });
  });

  describe("stageAndCommit()", () => {
    it("calls git add -A then git commit -m message", async () => {
      mockExecFileSync.mockImplementation(() => "");
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await provider.stageAndCommit("fix: resolve crash");

      const argLists = mockExecFileSync.mock.calls.map((c) => c[1] as string[]);
      expect(argLists.some((a) => a.includes("add") && a.includes("-A"))).toBe(true);
      expect(argLists.some((a) => a.includes("commit") && a.includes("-m") && a.includes("fix: resolve crash"))).toBe(
        true,
      );
    });

    it("skips when not in a git repo", async () => {
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await provider.stageAndCommit("fix: something");

      const argLists = mockExecFileSync.mock.calls.map((c) => c[1] as string[]);
      expect(argLists.every((a) => !a.includes("add") && !a.includes("commit"))).toBe(true);
    });
  });

  describe("listPullRequests()", () => {
    const prState = {
      nextPrNumber: 4,
      prs: [
        {
          number: 1,
          title: "Open PR A",
          state: "open",
          url: "file:///tmp/sc-test/prs/pr-1.md",
          head: "branch-a",
          base: "main",
          labels: ["bug"],
          createdAt: new Date().toISOString(),
        },
        {
          number: 2,
          title: "Merged PR B",
          state: "merged",
          url: "file:///tmp/sc-test/prs/pr-2.md",
          head: "branch-b",
          base: "main",
          labels: ["feature"],
          createdAt: new Date().toISOString(),
        },
        {
          number: 3,
          title: "Open PR C",
          state: "open",
          url: "file:///tmp/sc-test/prs/pr-3.md",
          head: "branch-c",
          base: "main",
          labels: ["bug"],
          createdAt: new Date().toISOString(),
        },
      ],
    };

    it("returns all PRs when no filter is specified", async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify(prState));
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      const prs = await provider.listPullRequests();
      expect(prs).toHaveLength(3);
    });

    it("filters by state=open", async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify(prState));
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      const prs = await provider.listPullRequests({ state: "open" });
      expect(prs).toHaveLength(2);
      expect(prs.every((p) => p.state === "open")).toBe(true);
    });

    it("filters by state=merged", async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify(prState));
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      const prs = await provider.listPullRequests({ state: "merged" });
      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(2);
    });

    it("returns all PRs when state=all", async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify(prState));
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      const prs = await provider.listPullRequests({ state: "all" });
      expect(prs).toHaveLength(3);
    });

    it("limits result count", async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify(prState));
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      const prs = await provider.listPullRequests({ limit: 2 });
      expect(prs).toHaveLength(2);
    });

    it("filters by label", async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify(prState));
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      const prs = await provider.listPullRequests({ labels: ["feature"] });
      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(2);
    });
  });

  describe("dispatchWorkflow()", () => {
    it("does not throw and logs skip", async () => {
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await expect(
        provider.dispatchWorkflow({ targetRepo: "org/other", workflow: "CI", inputs: {} }),
      ).resolves.toBeUndefined();
    });
  });

  describe("enableAutoMerge()", () => {
    it("does not throw and logs skip", async () => {
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await expect(provider.enableAutoMerge(42)).resolves.toBeUndefined();
    });
  });

  describe("createPullRequest() variants", () => {
    it("uses provided base branch over default", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const provider = fileSourceControl({ outputDir, baseBranch: "develop", logger: silentLogger });
      const pr = await provider.createPullRequest({
        title: "feat: add stuff",
        body: "body",
        head: "feature/add-stuff",
        base: "release",
      });
      expect(pr.state).toBe("open");
      // PR file content should contain the base branch
      const prContent = mockWriteFileSync.mock.calls[1][1] as string;
      expect(prContent).toContain("release");
    });

    it("assigns labels to the PR file content", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await provider.createPullRequest({
        title: "fix: labeled",
        body: "body",
        head: "fix/labeled",
        labels: ["bug", "triage"],
      });
      const prContent = mockWriteFileSync.mock.calls[1][1] as string;
      expect(prContent).toContain("bug, triage");
    });

    it("increments PR number on successive creates", async () => {
      let callCount = 0;
      mockReadFileSync.mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error("ENOENT"); // first create: no state
        return JSON.stringify({
          nextPrNumber: 2,
          prs: [
            { number: 1, title: "First", state: "open", url: "f", head: "h", base: "main", labels: [], createdAt: "" },
          ],
        });
      });
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await provider.createPullRequest({ title: "PR 1", body: "b", head: "h1" });
      const pr2 = await provider.createPullRequest({ title: "PR 2", body: "b", head: "h2" });
      expect(pr2.number).toBe(2);
    });
  });
});
