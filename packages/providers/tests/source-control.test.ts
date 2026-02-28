import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFile as _execFile } from "node:child_process";
import { github } from "../src/source-control/github.js";
import type { SourceControlProvider } from "../src/source-control/types.js";

// Mock child_process.execFile
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: Function) => {
    cb(null, { stdout: "", stderr: "" });
  }),
}));

const mockExecFile = vi.mocked(_execFile);

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

describe("github source-control provider", () => {
  let provider: SourceControlProvider;
  const config = {
    token: "ghp_test",
    owner: "acme",
    repo: "app",
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = github(config);
  });

  describe("factory", () => {
    it("returns an object implementing SourceControlProvider", () => {
      expect(typeof provider.verifyAccess).toBe("function");
      expect(typeof provider.configureBotIdentity).toBe("function");
      expect(typeof provider.createBranch).toBe("function");
      expect(typeof provider.pushBranch).toBe("function");
      expect(typeof provider.hasChanges).toBe("function");
      expect(typeof provider.hasNewCommits).toBe("function");
      expect(typeof provider.getChangedFiles).toBe("function");
      expect(typeof provider.resetPaths).toBe("function");
      expect(typeof provider.stageAndCommit).toBe("function");
      expect(typeof provider.createPullRequest).toBe("function");
      expect(typeof provider.listPullRequests).toBe("function");
      expect(typeof provider.findExistingPr).toBe("function");
      expect(typeof provider.dispatchWorkflow).toBe("function");
    });
  });

  describe("verifyAccess", () => {
    it("calls GitHub API to verify repo access", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ id: 123, full_name: "acme/app" }));

      await provider.verifyAccess();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/acme/app",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer ghp_test",
          }),
        }),
      );
      expect(config.logger.info).toHaveBeenCalledWith("Verified access to acme/app");
    });

    it("throws on API failure", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ message: "Not Found" }, 404));

      await expect(provider.verifyAccess()).rejects.toThrow("GitHub API GET /repos/acme/app failed (404)");
    });
  });

  describe("createPullRequest", () => {
    it("creates a PR via GitHub API", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ number: 42, html_url: "https://github.com/acme/app/pull/42", state: "open" }),
      );

      const pr = await provider.createPullRequest({
        title: "Fix bug",
        body: "Fixes the thing",
        head: "fix/bug-123",
      });

      expect(pr.number).toBe(42);
      expect(pr.url).toBe("https://github.com/acme/app/pull/42");
      expect(pr.state).toBe("open");
      expect(pr.title).toBe("Fix bug");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/acme/app/pulls",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"title":"Fix bug"'),
        }),
      );
    });

    it("adds labels after PR creation", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeJsonResponse({ number: 42, html_url: "https://github.com/acme/app/pull/42", state: "open" }),
        )
        .mockResolvedValueOnce(makeJsonResponse([]));

      await provider.createPullRequest({
        title: "Fix bug",
        body: "Fixes it",
        head: "fix/bug",
        labels: ["bug", "auto-fix"],
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.github.com/repos/acme/app/issues/42/labels",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"labels":["bug","auto-fix"]'),
        }),
      );
    });

    it("uses baseBranch config for default base", async () => {
      const customProvider = github({ ...config, baseBranch: "develop" });
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ number: 1, html_url: "https://github.com/acme/app/pull/1", state: "open" }),
      );

      await customProvider.createPullRequest({
        title: "Feature",
        body: "New feature",
        head: "feat/thing",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.base).toBe("develop");
    });
  });

  describe("findExistingPr", () => {
    it("finds matching open PR", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse([
          { number: 10, html_url: "https://github.com/acme/app/pull/10", title: "Fix ABC-123 bug", body: "Details" },
        ]),
      );

      const pr = await provider.findExistingPr("ABC-123");

      expect(pr).not.toBeNull();
      expect(pr!.number).toBe(10);
      expect(pr!.state).toBe("open");
    });

    it("finds matching merged PR when no open match", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse([])).mockResolvedValueOnce(
        makeJsonResponse([
          {
            number: 5,
            html_url: "https://github.com/acme/app/pull/5",
            title: "Fix ABC-456",
            body: null,
            merged_at: new Date().toISOString(),
          },
        ]),
      );

      const pr = await provider.findExistingPr("ABC-456");

      expect(pr).not.toBeNull();
      expect(pr!.number).toBe(5);
      expect(pr!.state).toBe("merged");
    });

    it("returns null when no match found", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse([])).mockResolvedValueOnce(makeJsonResponse([]));

      const pr = await provider.findExistingPr("UNKNOWN-999");
      expect(pr).toBeNull();
    });

    it("ignores merged PRs older than 30 days", async () => {
      const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
      mockFetch.mockResolvedValueOnce(makeJsonResponse([])).mockResolvedValueOnce(
        makeJsonResponse([
          {
            number: 1,
            html_url: "https://github.com/acme/app/pull/1",
            title: "Fix ABC-789",
            body: null,
            merged_at: oldDate,
          },
        ]),
      );

      const pr = await provider.findExistingPr("ABC-789");
      expect(pr).toBeNull();
    });
  });

  describe("hasNewCommits", () => {
    it("returns true when commits exist ahead of base", async () => {
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "3\n", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });

      const result = await provider.hasNewCommits();
      expect(result).toBe(true);
    });

    it("returns false when no commits ahead", async () => {
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "0\n", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });

      const result = await provider.hasNewCommits();
      expect(result).toBe(false);
    });
  });

  describe("getChangedFiles", () => {
    it("returns list of changed files", async () => {
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "src/index.ts\nsrc/utils.ts\n", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });

      const files = await provider.getChangedFiles();
      expect(files).toEqual(["src/index.ts", "src/utils.ts"]);
    });

    it("returns empty array when no changes", async () => {
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });

      const files = await provider.getChangedFiles();
      expect(files).toEqual([]);
    });
  });

  describe("listPullRequests", () => {
    it("lists open PRs by default", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse([
          {
            number: 1,
            html_url: "https://github.com/acme/app/pull/1",
            title: "Fix bug",
            state: "open",
            merged_at: null,
            closed_at: null,
            labels: [{ name: "bug" }],
          },
        ]),
      );

      const prs = await provider.listPullRequests();
      expect(prs).toHaveLength(1);
      expect(prs[0].state).toBe("open");
      expect(prs[0].number).toBe(1);
    });

    it("filters by label", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse([
          {
            number: 1,
            html_url: "url1",
            title: "PR 1",
            state: "open",
            merged_at: null,
            closed_at: null,
            labels: [{ name: "triage" }],
          },
          {
            number: 2,
            html_url: "url2",
            title: "PR 2",
            state: "open",
            merged_at: null,
            closed_at: null,
            labels: [{ name: "bug" }],
          },
        ]),
      );

      const prs = await provider.listPullRequests({ labels: ["triage"] });
      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(1);
    });

    it("returns merged PRs with mergedAt timestamp", async () => {
      const mergedAt = new Date().toISOString();
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse([
          {
            number: 5,
            html_url: "url5",
            title: "Merged PR",
            state: "closed",
            merged_at: mergedAt,
            closed_at: mergedAt,
            labels: [],
          },
          {
            number: 6,
            html_url: "url6",
            title: "Closed PR",
            state: "closed",
            merged_at: null,
            closed_at: mergedAt,
            labels: [],
          },
        ]),
      );

      const prs = await provider.listPullRequests({ state: "merged" });
      expect(prs).toHaveLength(1);
      expect(prs[0].state).toBe("merged");
      expect(prs[0].mergedAt).toBe(mergedAt);
    });
  });

  describe("configureBotIdentity", () => {
    it("configures git user.name and user.email", async () => {
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });

      await provider.configureBotIdentity();

      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(mockExecFile).toHaveBeenNthCalledWith(
        1,
        "git",
        ["config", "user.name", "github-actions[bot]"],
        expect.any(Function),
      );
      expect(mockExecFile).toHaveBeenNthCalledWith(
        2,
        "git",
        ["config", "user.email", "github-actions[bot]@users.noreply.github.com"],
        expect.any(Function),
      );
      expect(config.logger.debug).toHaveBeenCalledWith("Configured git bot identity");
    });
  });

  describe("createBranch", () => {
    it("calls git checkout -b with the branch name", async () => {
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });

      await provider.createBranch("fix/my-branch");

      expect(mockExecFile).toHaveBeenCalledWith("git", ["checkout", "-b", "fix/my-branch"], expect.any(Function));
      expect(config.logger.info).toHaveBeenCalledWith("Created branch: fix/my-branch");
    });
  });

  describe("pushBranch", () => {
    it("sets remote URL with token then pushes", async () => {
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });

      await provider.pushBranch("fix/my-branch");

      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(mockExecFile).toHaveBeenNthCalledWith(
        1,
        "git",
        ["remote", "set-url", "origin", "https://x-access-token:ghp_test@github.com/acme/app.git"],
        expect.any(Function),
      );
      expect(mockExecFile).toHaveBeenNthCalledWith(2, "git", ["push", "origin", "fix/my-branch"], expect.any(Function));
      expect(config.logger.info).toHaveBeenCalledWith("Pushed branch: fix/my-branch");
    });
  });

  describe("hasChanges", () => {
    it("returns true when unstaged changes exist", async () => {
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "src/index.ts\n", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });

      const result = await provider.hasChanges();
      expect(result).toBe(true);
    });

    it("returns true when staged changes exist", async () => {
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "src/utils.ts\n", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });

      const result = await provider.hasChanges();
      expect(result).toBe(true);
    });

    it("returns false when no changes exist", async () => {
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });

      const result = await provider.hasChanges();
      expect(result).toBe(false);
    });

    it("returns true when both staged and unstaged changes exist", async () => {
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "a.ts\n", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "b.ts\n", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });

      const result = await provider.hasChanges();
      expect(result).toBe(true);
    });
  });

  describe("resetPaths", () => {
    it("calls git checkout HEAD for each path", async () => {
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });

      await provider.resetPaths(["src/index.ts", "src/utils.ts"]);

      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(mockExecFile).toHaveBeenNthCalledWith(
        1,
        "git",
        ["checkout", "HEAD", "--", "src/index.ts"],
        expect.any(Function),
      );
      expect(mockExecFile).toHaveBeenNthCalledWith(
        2,
        "git",
        ["checkout", "HEAD", "--", "src/utils.ts"],
        expect.any(Function),
      );
      expect(config.logger.debug).toHaveBeenCalledWith("Reset paths: src/index.ts, src/utils.ts");
    });

    it("handles a single path", async () => {
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });

      await provider.resetPaths(["package.json"]);

      expect(mockExecFile).toHaveBeenCalledTimes(1);
      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        ["checkout", "HEAD", "--", "package.json"],
        expect.any(Function),
      );
    });
  });

  describe("stageAndCommit", () => {
    it("stages all files and commits with the given message", async () => {
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });

      await provider.stageAndCommit("fix: resolve null pointer issue");

      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(mockExecFile).toHaveBeenNthCalledWith(
        1,
        "git",
        ["add", "-A", "--", ".", ":!.github/triage-analysis", ":!.github/workflows"],
        expect.any(Function),
      );
      expect(mockExecFile).toHaveBeenNthCalledWith(
        2,
        "git",
        ["commit", "-m", "fix: resolve null pointer issue"],
        expect.any(Function),
      );
    });
  });

  describe("dispatchWorkflow", () => {
    it("dispatches a workflow via GitHub API", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({}, 204));

      await provider.dispatchWorkflow({
        targetRepo: "acme/other-app",
        workflow: "ci.yml",
        inputs: { ref: "fix-branch" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/acme/other-app/actions/workflows/ci.yml/dispatches",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"ref":"main"'),
        }),
      );
    });

    it("sends inputs in the request body", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({}, 204));

      await provider.dispatchWorkflow({
        targetRepo: "acme/other-app",
        workflow: "triage.yml",
        inputs: { linear_issue: "ABC-123", novelty_mode: "false" },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.inputs).toEqual({ linear_issue: "ABC-123", novelty_mode: "false" });
    });
  });
});
