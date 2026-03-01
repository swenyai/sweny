import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFile as _execFile } from "node:child_process";
import { gitlab } from "../src/source-control/gitlab.js";
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

function makeJsonResponse(data: unknown, status = 200, statusText = "OK"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ "content-length": String(JSON.stringify(data).length) }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

function make204Response(): Response {
  return {
    ok: true,
    status: 204,
    headers: new Headers({ "content-length": "0" }),
    json: () => Promise.resolve(undefined),
    text: () => Promise.resolve(""),
  } as Response;
}

describe("gitlab source-control provider", () => {
  let provider: SourceControlProvider;
  const config = {
    token: "glpat-test",
    projectId: 42 as string | number,
    baseUrl: "https://gitlab.example.com",
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = gitlab(config);
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
    it("calls GitLab API to verify project access", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ path_with_namespace: "acme/app" }));

      await provider.verifyAccess();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://gitlab.example.com/api/v4/projects/42",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "PRIVATE-TOKEN": "glpat-test",
          }),
        }),
      );
      expect(config.logger.info).toHaveBeenCalledWith("Verified access to acme/app");
    });

    it("throws on API failure", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ message: "Not Found" }, 404, "Not Found"));

      await expect(provider.verifyAccess()).rejects.toThrow("GitLab API error: 404 Not Found");
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
        ["config", "user.name", "gitlab-bot"],
        expect.any(Function),
      );
      expect(mockExecFile).toHaveBeenNthCalledWith(
        2,
        "git",
        ["config", "user.email", "gitlab-bot@noreply.gitlab.com"],
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

  describe("createPullRequest", () => {
    it("creates a merge request via GitLab API", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          iid: 7,
          web_url: "https://gitlab.example.com/acme/app/-/merge_requests/7",
          state: "opened",
          title: "Fix bug",
        }),
      );

      const pr = await provider.createPullRequest({
        title: "Fix bug",
        body: "Fixes the thing",
        head: "fix/bug-123",
      });

      expect(pr.number).toBe(7);
      expect(pr.url).toBe("https://gitlab.example.com/acme/app/-/merge_requests/7");
      expect(pr.state).toBe("open");
      expect(pr.title).toBe("Fix bug");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://gitlab.example.com/api/v4/projects/42/merge_requests",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "PRIVATE-TOKEN": "glpat-test",
            "Content-Type": "application/json",
          }),
          body: expect.stringContaining('"source_branch":"fix/bug-123"'),
        }),
      );
    });

    it("sends labels in the body", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          iid: 8,
          web_url: "https://gitlab.example.com/acme/app/-/merge_requests/8",
          state: "opened",
          title: "Feature",
        }),
      );

      await provider.createPullRequest({
        title: "Feature",
        body: "New feature",
        head: "feat/thing",
        labels: ["bug", "auto-fix"],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.labels).toBe("bug,auto-fix");
    });

    it("uses baseBranch config for default target_branch", async () => {
      const customProvider = gitlab({ ...config, baseBranch: "develop" });
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          iid: 1,
          web_url: "https://gitlab.example.com/acme/app/-/merge_requests/1",
          state: "opened",
          title: "Feature",
        }),
      );

      await customProvider.createPullRequest({
        title: "Feature",
        body: "New feature",
        head: "feat/thing",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.target_branch).toBe("develop");
    });
  });

  describe("listPullRequests", () => {
    it("lists open MRs by default", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse([
          {
            iid: 1,
            web_url: "https://gitlab.example.com/acme/app/-/merge_requests/1",
            title: "Fix bug",
            state: "opened",
            merged_at: null,
            closed_at: null,
            labels: ["bug"],
          },
        ]),
      );

      const prs = await provider.listPullRequests();
      expect(prs).toHaveLength(1);
      expect(prs[0].state).toBe("open");
      expect(prs[0].number).toBe(1);
    });

    it("maps opened state to open", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse([
          {
            iid: 2,
            web_url: "url2",
            title: "MR 2",
            state: "opened",
            merged_at: null,
            closed_at: null,
            labels: [],
          },
        ]),
      );

      const prs = await provider.listPullRequests({ state: "open" });
      expect(prs[0].state).toBe("open");

      // Verify state param was sent as "opened" (GitLab's format)
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("state=opened"), expect.anything());
    });

    it("maps merged state correctly", async () => {
      const mergedAt = new Date().toISOString();
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse([
          {
            iid: 5,
            web_url: "url5",
            title: "Merged MR",
            state: "merged",
            merged_at: mergedAt,
            closed_at: null,
            labels: [],
          },
        ]),
      );

      const prs = await provider.listPullRequests({ state: "merged" });
      expect(prs).toHaveLength(1);
      expect(prs[0].state).toBe("merged");
      expect(prs[0].mergedAt).toBe(mergedAt);
    });

    it("maps closed state correctly", async () => {
      const closedAt = new Date().toISOString();
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse([
          {
            iid: 6,
            web_url: "url6",
            title: "Closed MR",
            state: "closed",
            merged_at: null,
            closed_at: closedAt,
            labels: [],
          },
        ]),
      );

      const prs = await provider.listPullRequests({ state: "closed" });
      expect(prs).toHaveLength(1);
      expect(prs[0].state).toBe("closed");
      expect(prs[0].closedAt).toBe(closedAt);
    });

    it("filters by label", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse([
          {
            iid: 3,
            web_url: "url3",
            title: "MR 3",
            state: "opened",
            merged_at: null,
            closed_at: null,
            labels: ["triage"],
          },
        ]),
      );

      await provider.listPullRequests({ labels: ["triage"] });

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("labels=triage"), expect.anything());
    });
  });

  describe("findExistingPr", () => {
    it("finds matching open MR", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse([
          {
            iid: 10,
            web_url: "https://gitlab.example.com/acme/app/-/merge_requests/10",
            title: "Fix ABC-123 bug",
            description: "Details",
            state: "opened",
            merged_at: null,
          },
        ]),
      );

      const pr = await provider.findExistingPr("ABC-123");

      expect(pr).not.toBeNull();
      expect(pr!.number).toBe(10);
      expect(pr!.state).toBe("open");
    });

    it("finds matching merged MR when no open match", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse([])).mockResolvedValueOnce(
        makeJsonResponse([
          {
            iid: 5,
            web_url: "https://gitlab.example.com/acme/app/-/merge_requests/5",
            title: "Fix ABC-456",
            description: null,
            state: "merged",
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

    it("ignores merged MRs older than 30 days", async () => {
      const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
      mockFetch.mockResolvedValueOnce(makeJsonResponse([])).mockResolvedValueOnce(
        makeJsonResponse([
          {
            iid: 1,
            web_url: "https://gitlab.example.com/acme/app/-/merge_requests/1",
            title: "Fix ABC-789",
            description: null,
            state: "merged",
            merged_at: oldDate,
          },
        ]),
      );

      const pr = await provider.findExistingPr("ABC-789");
      expect(pr).toBeNull();
    });
  });

  describe("dispatchWorkflow", () => {
    it("triggers a pipeline via GitLab API", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ id: 1, status: "created" }));

      await provider.dispatchWorkflow({
        targetRepo: "acme/other-app",
        workflow: "main",
        inputs: { ref: "fix-branch" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://gitlab.example.com/api/v4/projects/acme%2Fother-app/pipeline",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "PRIVATE-TOKEN": "glpat-test",
          }),
          body: expect.stringContaining('"ref":"main"'),
        }),
      );
    });

    it("sends variables in the request body", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ id: 2, status: "created" }));

      await provider.dispatchWorkflow({
        targetRepo: "acme/other-app",
        workflow: "main",
        inputs: { linear_issue: "ABC-123", novelty_mode: "false" },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.variables).toEqual(
        expect.arrayContaining([
          { key: "linear_issue", value: "ABC-123", variable_type: "env_var" },
          { key: "novelty_mode", value: "false", variable_type: "env_var" },
        ]),
      );
    });

    it("uses current project when targetRepo is not provided", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ id: 3, status: "created" }));

      await provider.dispatchWorkflow({
        targetRepo: "",
        workflow: "develop",
      });

      // When targetRepo is empty/falsy, it should fall back to the configured projectId
      // But the implementation checks `opts.targetRepo` which is "" (falsy), so projectId is used
      expect(mockFetch).toHaveBeenCalledWith(
        "https://gitlab.example.com/api/v4/projects/42/pipeline",
        expect.anything(),
      );
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

  describe("pushBranch", () => {
    it("fetches project path, sets remote URL with token, then pushes", async () => {
      // First: fetch call to get project path
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ path_with_namespace: "acme/app" }));
      // Then: two git commands (remote set-url, push)
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });
      mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, cb: unknown) => {
        (cb as Function)(null, { stdout: "", stderr: "" });
        return {} as ReturnType<typeof _execFile>;
      });

      await provider.pushBranch("fix/my-branch");

      expect(mockFetch).toHaveBeenCalledWith("https://gitlab.example.com/api/v4/projects/42", expect.anything());
      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(mockExecFile).toHaveBeenNthCalledWith(
        1,
        "git",
        ["remote", "set-url", "origin", "https://gitlab-ci-token@gitlab.example.com/acme/app.git"],
        expect.any(Function),
      );
      expect(mockExecFile).toHaveBeenNthCalledWith(
        2,
        "git",
        ["-c", "http.extraheader=PRIVATE-TOKEN: glpat-test", "push", "origin", "fix/my-branch"],
        expect.any(Function),
      );
      expect(config.logger.info).toHaveBeenCalledWith("Pushed branch: fix/my-branch");
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
      expect(mockExecFile).toHaveBeenNthCalledWith(1, "git", ["add", "-A"], expect.any(Function));
      expect(mockExecFile).toHaveBeenNthCalledWith(
        2,
        "git",
        ["commit", "-m", "fix: resolve null pointer issue"],
        expect.any(Function),
      );
    });
  });

  describe("URL-encoded projectId", () => {
    it("encodes string projectId in API URLs", async () => {
      const stringProvider = gitlab({ ...config, projectId: "acme/my-project" });
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ path_with_namespace: "acme/my-project" }));

      await stringProvider.verifyAccess();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://gitlab.example.com/api/v4/projects/acme%2Fmy-project",
        expect.anything(),
      );
    });
  });

  describe("default baseUrl", () => {
    it("defaults to https://gitlab.com when baseUrl is not provided", async () => {
      const defaultProvider = gitlab({ token: "glpat-test", projectId: 99 });
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ path_with_namespace: "acme/app" }));

      await defaultProvider.verifyAccess();

      expect(mockFetch).toHaveBeenCalledWith("https://gitlab.com/api/v4/projects/99", expect.anything());
    });
  });
});
