import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoist mock functions so they are available when vi.mock() factory runs ──
const { mockMkdirSync, mockWriteFileSync, mockReadFileSync, mockReaddirSync, mockExecSync } = vi.hoisted(() => ({
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockExecSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
}));

vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
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
    // detectGit() runs in constructor — default to not-in-git-repo
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "git rev-parse --is-inside-work-tree") {
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
      mockExecSync.mockImplementation((cmd: string) => {
        // All git commands succeed
        return "";
      });

      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await provider.createBranch("feature/my-branch");

      const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
      expect(calls.some((c) => c.includes("checkout -b feature/my-branch"))).toBe(true);
    });

    it("skips branch creation when not in a git repo", async () => {
      // beforeEach already makes detectGit throw
      const provider = fileSourceControl({ outputDir, logger: silentLogger });
      await provider.createBranch("feature/my-branch");

      const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
      expect(calls.every((c) => !c.includes("checkout -b"))).toBe(true);
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
  });
});
