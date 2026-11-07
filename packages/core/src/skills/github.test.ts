import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { github, encodeRepoFilePath } from "./github.js";
import { isToolRefusal, type Logger, type ToolContext } from "../types.js";

const ctx = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  config: { GITHUB_TOKEN: "test-token" },
  logger: console,
  ...overrides,
});

function makeLogger(): Logger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    info: () => undefined,
    warn: (msg: string) => warnings.push(msg),
    error: () => undefined,
    debug: () => undefined,
    warnings,
  };
}

const createPr = github.tools.find((t) => t.name === "github_create_pr")!;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ALREADY_EXISTS_422 = {
  message: "Validation Failed",
  errors: [
    {
      resource: "PullRequest",
      code: "custom",
      message: "A pull request already exists for letsoffload:off-1768-fix.",
    },
  ],
  documentation_url: "https://docs.github.com/rest/pulls/pulls#create-a-pull-request",
};

describe("github_create_pr", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the new PR on the happy path", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { number: 42, html_url: "https://github.com/o/r/pull/42" }))
      .mockResolvedValueOnce(jsonResponse(200, [{ name: "sweny" }]));

    const result: any = await createPr.handler(
      { repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix", body: "body" },
      ctx(),
    );

    expect(result).toMatchObject({ number: 42 });
    expect(result.reused).toBeFalsy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/o/r/pulls",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns the existing open PR when GitHub responds 422 'pull request already exists'", async () => {
    const existingPr = {
      number: 572,
      html_url: "https://github.com/o/r/pull/572",
      head: { ref: "x-1-fix" },
      state: "open",
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(422, ALREADY_EXISTS_422))
      .mockResolvedValueOnce(jsonResponse(200, [existingPr]))
      .mockResolvedValueOnce(jsonResponse(200, [{ name: "sweny" }]));

    const result: any = await createPr.handler({ repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" }, ctx());

    expect(result).toMatchObject({ number: 572, reused: true });
    const listCall = fetchMock.mock.calls[1][0] as string;
    expect(listCall).toContain("/repos/o/r/pulls");
    expect(listCall).toContain("head=o%3Ax-1-fix");
    expect(listCall).toContain("state=open");
  });

  it("falls back to a closed-state lookup if no open PR matches", async () => {
    const closedPr = { number: 9, html_url: "https://github.com/o/r/pull/9", state: "closed" };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(422, ALREADY_EXISTS_422))
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(200, [closedPr]));

    const result: any = await createPr.handler({ repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" }, ctx());

    expect(result).toMatchObject({ number: 9, reused: true });
  });

  it("still throws on a 422 that is not the 'already exists' shape", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, {
        message: "Validation Failed",
        errors: [{ resource: "PullRequest", code: "invalid", message: "Base branch was modified." }],
      }),
    );

    await expect(createPr.handler({ repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" }, ctx())).rejects.toThrow(
      /HTTP 422/,
    );
  });

  it("still throws on other non-2xx statuses", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { message: "Server error" }));
    await expect(createPr.handler({ repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" }, ctx())).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it("defaults the label set to [sweny, agent] when caller omits labels", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { number: 7, html_url: "https://github.com/o/r/pull/7" }))
      .mockResolvedValueOnce(jsonResponse(200, [{ name: "sweny" }, { name: "agent" }]));

    await createPr.handler({ repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" }, ctx());

    const labelCall = fetchMock.mock.calls[1];
    expect(labelCall[0]).toBe("https://api.github.com/repos/o/r/issues/7/labels");
    expect(JSON.parse(labelCall[1].body)).toEqual({ labels: ["sweny", "agent"] });
  });

  it("forwards an explicit labels array verbatim", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { number: 8, html_url: "https://github.com/o/r/pull/8" }))
      .mockResolvedValueOnce(jsonResponse(200, [{ name: "sweny" }, { name: "agent" }, { name: "triage" }]));

    await createPr.handler(
      { repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix", labels: ["sweny", "agent", "triage"] },
      ctx(),
    );

    const labelCall = fetchMock.mock.calls[1];
    expect(JSON.parse(labelCall[1].body)).toEqual({ labels: ["sweny", "agent", "triage"] });
  });

  it("does not relabel a reused PR (idempotent path skips labeling)", async () => {
    const existingPr = { number: 99, html_url: "https://github.com/o/r/pull/99", state: "open" };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(422, ALREADY_EXISTS_422))
      .mockResolvedValueOnce(jsonResponse(200, [existingPr]));

    await createPr.handler({ repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" }, ctx());

    // Exactly two calls: POST /pulls (422) + GET /pulls?head=... (lookup).
    // No third call to /issues/:n/labels because reused === true.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propagates the 422 if the existing-PR lookup itself fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(422, ALREADY_EXISTS_422))
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(200, []));

    await expect(createPr.handler({ repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" }, ctx())).rejects.toThrow(
      /already exists/i,
    );
  });

  it("logs a warn when the label POST fails after a successful PR create", async () => {
    // Closes the silent-failure path called out in the review of PR #189/#193:
    // a label POST that returns 5xx (or any non-2xx) was caught and swallowed
    // with zero log signal, so a label-misconfigured run looked indistinguishable
    // from a successful one. The PR is still considered created (labeling is
    // best-effort), but operators get a single line in the log naming the
    // failure so they can investigate without grepping for ghosts.
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { number: 7, html_url: "https://github.com/o/r/pull/7" }))
      .mockResolvedValueOnce(jsonResponse(500, { message: "labels endpoint down" }));

    const logger = makeLogger();
    const result: any = await createPr.handler(
      { repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" },
      ctx({ logger }),
    );

    // PR creation still considered successful — labels are best-effort.
    expect(result).toMatchObject({ number: 7 });
    expect(result.reused).toBeFalsy();
    // A single warn line names the PR and the failure shape.
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toMatch(/label/i);
    expect(logger.warnings[0]).toMatch(/pull\/7|#7/);
  });

  it("does not warn when label POST succeeds (no false positives in CI logs)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { number: 12, html_url: "https://github.com/o/r/pull/12" }))
      .mockResolvedValueOnce(jsonResponse(200, [{ name: "sweny" }, { name: "agent" }]));

    const logger = makeLogger();
    await createPr.handler({ repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" }, ctx({ logger }));

    expect(logger.warnings).toHaveLength(0);
  });
});

// ─── #544: never open a PR from a remote head sweny did not push ──

describe("github_create_pr after the sweny-side push", () => {
  const LOCAL = "a".repeat(40);
  const OTHER = "b".repeat(40);
  let fetchMock: ReturnType<typeof vi.fn>;
  let calls: Array<{ url: string; method: string }>;

  /** Routes the handler's API calls; `refs` answers GET /git/ref/heads/x-1-fix. */
  function route(o: { branch?: () => Response; ref?: () => Response; pr?: unknown }) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (url === "https://api.github.com/repos/o/r" && method === "GET") {
        return jsonResponse(200, { default_branch: "main" });
      }
      if (url === "https://api.github.com/repos/o/r/branches/x-1-fix") {
        return o.branch ? o.branch() : jsonResponse(404, { message: "Branch not found" });
      }
      if (url.startsWith("https://api.github.com/repos/o/r/pulls?") && method === "GET") {
        return jsonResponse(200, [{ number: 3 }]);
      }
      if (url === "https://api.github.com/repos/o/r/git/ref/heads/x-1-fix") {
        return o.ref ? o.ref() : jsonResponse(404, { message: "Not Found" });
      }
      if (url === "https://api.github.com/repos/o/r/pulls" && method === "POST") {
        return jsonResponse(201, o.pr ?? { number: 7, html_url: "https://github.com/o/r/pull/7" });
      }
      return jsonResponse(200, []);
    });
  }

  const refAt = (sha: string) => () =>
    jsonResponse(200, { ref: "refs/heads/x-1-fix", object: { sha, type: "commit" } });
  const failedPush = (sha: string | null = LOCAL) =>
    vi.fn(async () => ({
      pushed: false,
      attempted: true,
      reason: "git push failed: ! [rejected] (stale info)",
      ...(sha ? { sha } : {}),
    }));
  const posted = () => calls.some((c) => c.url === "https://api.github.com/repos/o/r/pulls" && c.method === "POST");
  const refRead = () => calls.some((c) => c.url.includes("/git/ref/heads/"));

  beforeEach(() => {
    fetchMock = vi.fn();
    calls = [];
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a failed push opens the PR when the remote head is the local commit", async () => {
    route({ ref: refAt(LOCAL), pr: { number: 7, html_url: "https://github.com/o/r/pull/7", head: { sha: LOCAL } } });
    const pushBranch = failedPush();
    const result: any = await createPr.handler(
      { repo: "o/r", title: "t", head: "x-1-fix" },
      ctx({ logger: makeLogger(), pushBranch }),
    );
    expect(pushBranch).toHaveBeenCalledTimes(1);
    expect(refRead()).toBe(true);
    expect(posted()).toBe(true);
    expect(result).toMatchObject({ number: 7, head_sha: LOCAL });
    expect(result.refused).toBeUndefined();
  });

  it("a failed push with a different remote head refuses and never requests the PR", async () => {
    route({ ref: refAt(OTHER) });
    const logger = makeLogger();
    const result: any = await createPr.handler(
      { repo: "o/r", title: "t", head: "x-1-fix" },
      ctx({ logger, pushBranch: failedPush() }),
    );
    expect(posted()).toBe(false);
    expect(result).toMatchObject({ refused: true, head: "x-1-fix", local_sha: LOCAL, remote_sha: OTHER });
    expect(isToolRefusal(result)).toBe(true);
    // The reason is fixed wording (receipts carry it); the specifics are in detail.
    expect(result.reason).toBe("the head push failed and the remote head is not the commit this run produced");
    expect(result.reason).not.toContain("x-1-fix");
    expect(result.detail).toContain(LOCAL);
    expect(result.detail).toContain(OTHER);
    expect(result.detail).toContain("git push failed");
    expect(result.number).toBeUndefined();
    expect(result.html_url).toBeUndefined();
    expect(logger.warnings.some((w) => w.includes("refusing"))).toBe(true);
  });

  it("a failed push with no remote head refuses", async () => {
    route({ ref: () => jsonResponse(404, { message: "Not Found" }) });
    const result: any = await createPr.handler(
      { repo: "o/r", title: "t", head: "x-1-fix" },
      ctx({ logger: makeLogger(), pushBranch: failedPush() }),
    );
    expect(posted()).toBe(false);
    expect(result).toMatchObject({ refused: true, local_sha: LOCAL, remote_sha: null });
  });

  it("a failed push fails closed when the remote head cannot be read", async () => {
    route({ ref: () => jsonResponse(500, { message: "boom" }) });
    const result: any = await createPr.handler(
      { repo: "o/r", title: "t", head: "x-1-fix" },
      ctx({ logger: makeLogger(), pushBranch: failedPush() }),
    );
    expect(posted()).toBe(false);
    expect(result).toMatchObject({ refused: true, local_sha: LOCAL, remote_sha: null });
    expect(result.reason).toBe("the head push failed and the remote head could not be read");
    expect(result.detail).toMatch(/cannot read the remote head/);
  });

  it("a failed push fails closed on a ref answer that names another ref", async () => {
    route({ ref: () => jsonResponse(200, { ref: "refs/heads/x-1-fix-2", object: { sha: LOCAL } }) });
    const result: any = await createPr.handler(
      { repo: "o/r", title: "t", head: "x-1-fix" },
      ctx({ logger: makeLogger(), pushBranch: failedPush() }),
    );
    expect(posted()).toBe(false);
    expect(result).toMatchObject({ refused: true, remote_sha: null });
  });

  it("a failed push that reports no local commit refuses without reading the remote", async () => {
    route({ ref: refAt(LOCAL) });
    const result: any = await createPr.handler(
      { repo: "o/r", title: "t", head: "x-1-fix" },
      ctx({ logger: makeLogger(), pushBranch: failedPush(null) }),
    );
    expect(posted()).toBe(false);
    expect(refRead()).toBe(false);
    expect(result).toMatchObject({ refused: true, local_sha: null });
  });

  it("a lease skip is unchanged: no push, no ref read, the PR is requested, and the result names the remote head", async () => {
    route({ branch: () => jsonResponse(200, { protected: true, commit: { sha: OTHER } }) });
    const pushBranch = failedPush();
    const result: any = await createPr.handler(
      { repo: "o/r", title: "t", head: "x-1-fix" },
      ctx({ logger: makeLogger(), pushBranch }),
    );
    expect(pushBranch).not.toHaveBeenCalled();
    expect(refRead()).toBe(false);
    expect(posted()).toBe(true);
    expect(result).toMatchObject({ number: 7, head_sha: OTHER });
  });

  it("a pusher guard skip (attempted: false) is unchanged: no ref read, the PR is requested", async () => {
    route({});
    const pushBranch = vi.fn(async () => ({ pushed: false, attempted: false, reason: "no local branch x-1-fix" }));
    const result: any = await createPr.handler(
      { repo: "o/r", title: "t", head: "x-1-fix" },
      ctx({ logger: makeLogger(), pushBranch }),
    );
    expect(pushBranch).toHaveBeenCalledTimes(1);
    expect(refRead()).toBe(false);
    expect(posted()).toBe(true);
    expect(result).toMatchObject({ number: 7 });
    expect(result.refused).toBeUndefined();
  });

  it("a failed push whose PR comes back with another head returns a refusal naming the PR, and adds no labels", async () => {
    route({ ref: refAt(LOCAL), pr: { number: 7, html_url: "https://github.com/o/r/pull/7", head: { sha: OTHER } } });
    const logger = makeLogger();
    const result: any = await createPr.handler(
      { repo: "o/r", title: "t", head: "x-1-fix" },
      ctx({ logger, pushBranch: failedPush() }),
    );
    expect(posted()).toBe(true);
    expect(isToolRefusal(result)).toBe(true);
    expect(result).toMatchObject({
      refused: true,
      reason: "the PR was opened but its head is not the commit this run produced",
      number: 7,
      html_url: "https://github.com/o/r/pull/7",
      local_sha: LOCAL,
      remote_sha: OTHER,
    });
    // Never closed (no PATCH) and never labeled.
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(calls.some((c) => c.url.includes("/labels"))).toBe(false);
    expect(logger.warnings.some((w) => w.includes("not verified"))).toBe(true);
  });

  it("a failed push whose PR comes back with no head sha is refused as unverified", async () => {
    route({ ref: refAt(LOCAL), pr: { number: 7, html_url: "https://github.com/o/r/pull/7" } });
    const result: any = await createPr.handler(
      { repo: "o/r", title: "t", head: "x-1-fix" },
      ctx({ logger: makeLogger(), pushBranch: failedPush() }),
    );
    expect(result).toMatchObject({
      refused: true,
      reason: "the PR was opened but its head commit could not be verified",
      number: 7,
      remote_sha: null,
    });
  });

  it("the post-create check runs only after a failed push: a lease skip's PR is returned as is", async () => {
    route({
      branch: () => jsonResponse(200, { protected: true, commit: { sha: OTHER } }),
      pr: { number: 7, head: { sha: LOCAL } },
    });
    const result: any = await createPr.handler(
      { repo: "o/r", title: "t", head: "x-1-fix" },
      ctx({ logger: makeLogger(), pushBranch: failedPush() }),
    );
    expect(result.refused).toBeUndefined();
    expect(result).toMatchObject({ number: 7, head_sha: LOCAL });
  });

  it("the result's head_sha is the head GitHub reports for the PR", async () => {
    route({ pr: { number: 7, head: { ref: "x-1-fix", sha: LOCAL } } });
    const pushBranch = vi.fn(async () => ({ pushed: true, attempted: true, sha: LOCAL }));
    const result: any = await createPr.handler(
      { repo: "o/r", title: "t", head: "x-1-fix" },
      ctx({ logger: makeLogger(), pushBranch }),
    );
    expect(refRead()).toBe(false);
    expect(result).toMatchObject({ number: 7, head_sha: LOCAL });
  });
});

// ─── Input hardening (issue #226) ─────────────────────────────────
//
// Threat model: tool arguments are LLM-controlled at runtime and can be
// steered by prompt-injected content. A `path` containing `?`, `#`, or `..`
// must not be able to alter the request target.

describe("encodeRepoFilePath", () => {
  it("preserves / between segments and leaves normal paths readable", () => {
    expect(encodeRepoFilePath("src/lib/file.ts")).toBe("src/lib/file.ts");
  });

  it("percent-encodes ? so the path cannot inject query parameters", () => {
    expect(encodeRepoFilePath("file.ts?ref=evil")).toBe("file.ts%3Fref%3Devil");
  });

  it("percent-encodes # so the path cannot truncate the request via a fragment", () => {
    expect(encodeRepoFilePath("file#.ts")).toBe("file%23.ts");
  });

  it("rejects .. segments (path traversal out of the contents endpoint)", () => {
    expect(() => encodeRepoFilePath("../../../repos/other/secrets")).toThrow(/path segment/i);
  });

  it("rejects . segments", () => {
    expect(() => encodeRepoFilePath("./src/file.ts")).toThrow(/path segment/i);
  });

  it("encodes spaces and unicode within segments", () => {
    expect(encodeRepoFilePath("docs/my file.md")).toBe("docs/my%20file.md");
  });
});

describe("github_get_file input hardening", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const getFile = github.tools.find((t) => t.name === "github_get_file")!;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the encoded path, not the raw one", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: "", encoding: "none" }));

    await getFile.handler({ repo: "o/r", path: "src/a b.ts?x=1" }, ctx());

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://api.github.com/repos/o/r/contents/src/a%20b.ts%3Fx%3D1");
  });

  it("rejects a path containing .. without making any request", async () => {
    await expect(getFile.handler({ repo: "o/r", path: "../../meta" }, ctx())).rejects.toThrow(/path segment/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("URL-encodes the ref query parameter", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: "", encoding: "none" }));

    await getFile.handler({ repo: "o/r", path: "README.md", ref: "main&per_page=100" }, ctx());

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://api.github.com/repos/o/r/contents/README.md?ref=main%26per_page%3D100");
  });

  it("still decodes base64 content on the happy path", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { content: Buffer.from("hello").toString("base64"), encoding: "base64" }),
    );

    const result: any = await getFile.handler({ repo: "o/r", path: "README.md" }, ctx());

    expect(result.decoded_content).toBe("hello");
  });
});

describe("github_list_pr_files", () => {
  const tool = github.tools.find((t) => t.name === "github_list_pr_files")!;
  afterEach(() => vi.unstubAllGlobals());

  it("is a read tool and trims patch bodies", async () => {
    expect(tool.access).toBe("read");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, [
          { filename: "src/a.ts", status: "modified", additions: 3, deletions: 1, changes: 4, patch: "@@ body" },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    const out: any = await tool.handler({ repo: "o/r", number: 7 }, ctx());
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.github.com/repos/o/r/pulls/7/files?per_page=100");
    expect(out.count).toBe(1);
    expect(out.truncated).toBe(false);
    expect(out.files[0]).toEqual({ filename: "src/a.ts", status: "modified", additions: 3, deletions: 1, changes: 4 });
  });
});

describe("github_list_dependabot_alerts", () => {
  const tool = github.tools.find((t) => t.name === "github_list_dependabot_alerts")!;
  afterEach(() => vi.unstubAllGlobals());

  it("is a read tool and maps alerts to a compact shape", async () => {
    expect(tool.access).toBe("read");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, [
        {
          number: 5,
          html_url: "https://github.com/o/r/security/dependabot/5",
          dependency: { package: { name: "lodash", ecosystem: "npm" }, manifest_path: "package-lock.json" },
          security_advisory: {
            severity: "high",
            ghsa_id: "GHSA-xxxx",
            cve_id: "CVE-1",
            summary: "Prototype pollution",
          },
          security_vulnerability: {
            vulnerable_version_range: "< 4.17.21",
            first_patched_version: { identifier: "4.17.21" },
          },
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out: any = await tool.handler({ repo: "o/r", severity: "high" }, ctx());
    expect(fetchMock.mock.calls[0][0]).toContain("/repos/o/r/dependabot/alerts?state=open&per_page=50&severity=high");
    expect(out.unavailable).toBe(false);
    expect(out.alerts[0]).toMatchObject({ package: "lodash", severity: "high", patched_version: "4.17.21" });
  });

  it("returns unavailable instead of throwing on 403", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, { message: "Resource not accessible" })));
    const out: any = await tool.handler({ repo: "o/r" }, ctx());
    expect(out).toEqual({ unavailable: true, status: 403, alerts: [] });
  });

  it("still throws on other errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { message: "boom" })));
    await expect(tool.handler({ repo: "o/r" }, ctx())).rejects.toThrow(/HTTP 500/);
  });
});

describe("github_set_issue_state", () => {
  const setState = github.tools.find((t) => t.name === "github_set_issue_state")!;
  afterEach(() => vi.unstubAllGlobals());

  it("is a write tool", () => {
    expect(setState.access).toBe("write");
  });

  it.each([
    ["reopen", { state: "open", state_reason: "reopened" }],
    ["close", { state: "closed", state_reason: "completed" }],
  ])("%s PATCHes the issue", async (state, body) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { number: 7, state: body.state }));
    vi.stubGlobal("fetch", fetchMock);
    const out: any = await setState.handler({ repo: "acme/api", issue_number: 7, state }, ctx());
    expect(out.number).toBe(7);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/acme/api/issues/7");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("rejects any other state without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(setState.handler({ repo: "acme/api", issue_number: 7, state: "delete" }, ctx())).rejects.toThrow(
      /reopen/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
