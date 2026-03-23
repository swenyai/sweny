/**
 * Tests for runJob() in runner.ts.
 *
 * Mocking strategy (ESM + Vitest):
 *   - vi.mock(...) calls are hoisted above imports by vitest
 *   - await import(...) is used after mocks are in place to get the module
 *   - vi.spyOn(globalThis, "fetch") mocks the internal API calls
 *   - process.chdir is spied on so the test process doesn't try to enter fake dirs
 */

import { randomBytes, createCipheriv } from "node:crypto";
import type { WorkflowResult } from "@sweny-ai/engine";
import type { WorkerJobPayload } from "@sweny-ai/shared";

// ---------------------------------------------------------------------------
// Mock env — must be before any module that imports env.js
// ---------------------------------------------------------------------------

vi.mock("../src/env.js", () => ({
  env: {
    REDIS_URL: "redis://localhost:6379",
    INTERNAL_API_URL: "http://localhost:3001",
    QUEUE_NAME: "sweny-jobs",
    CONCURRENCY: 1,
    CODING_AGENT: "claude",
  },
}));

// ---------------------------------------------------------------------------
// Mock child_process — git clone resolves immediately
// ---------------------------------------------------------------------------

const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:util", () => ({
  promisify: () => mockExecFile,
}));

// ---------------------------------------------------------------------------
// Mock os — stable tmpdir so startsWith check passes
// ---------------------------------------------------------------------------

vi.mock("node:os", () => ({
  tmpdir: () => "/tmp",
}));

// ---------------------------------------------------------------------------
// Mock fs/promises
// ---------------------------------------------------------------------------

const mockMkdtemp = vi.fn();
const mockRm = vi.fn();
const mockWriteFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  mkdtemp: (...args: unknown[]) => mockMkdtemp(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

// ---------------------------------------------------------------------------
// Mock engine
// ---------------------------------------------------------------------------

const mockRunWorkflow = vi.fn();

vi.mock("@sweny-ai/engine", () => ({
  runWorkflow: (...args: unknown[]) => mockRunWorkflow(...args),
  triageWorkflow: { definition: { id: "triage", name: "Triage", steps: {}, initial: "end" }, implementations: {} },
  implementWorkflow: {
    definition: { id: "implement", name: "Implement", steps: {}, initial: "end" },
    implementations: {},
  },
  createProviderRegistry: () => {
    const map = new Map<string, unknown>();
    return {
      get: (key: string) => {
        if (!map.has(key)) throw new Error(`Provider "${key}" not registered`);
        return map.get(key);
      },
      has: (key: string) => map.has(key),
      set: (key: string, val: unknown) => map.set(key, val),
    };
  },
}));

// ---------------------------------------------------------------------------
// Mock providers
// ---------------------------------------------------------------------------

vi.mock("@sweny-ai/providers/observability", () => ({
  datadog: vi.fn().mockReturnValue({ verifyAccess: vi.fn() }),
  sentry: vi.fn().mockReturnValue({ verifyAccess: vi.fn() }),
  cloudwatch: vi.fn().mockReturnValue({ verifyAccess: vi.fn() }),
  splunk: vi.fn().mockReturnValue({ verifyAccess: vi.fn() }),
  elastic: vi.fn().mockReturnValue({ verifyAccess: vi.fn() }),
  newrelic: vi.fn().mockReturnValue({ verifyAccess: vi.fn() }),
  loki: vi.fn().mockReturnValue({ verifyAccess: vi.fn() }),
  betterstack: vi.fn().mockReturnValue({ verifyAccess: vi.fn() }),
  vercel: vi.fn().mockReturnValue({ verifyAccess: vi.fn() }),
  supabase: vi.fn().mockReturnValue({ verifyAccess: vi.fn() }),
}));

vi.mock("@sweny-ai/providers/issue-tracking", () => ({
  linear: vi.fn().mockReturnValue({ verifyAccess: vi.fn() }),
  jira: vi.fn().mockReturnValue({ verifyAccess: vi.fn() }),
  githubIssues: vi.fn().mockReturnValue({ verifyAccess: vi.fn() }),
}));

vi.mock("@sweny-ai/providers/source-control", () => ({
  github: vi.fn().mockReturnValue({ verifyAccess: vi.fn() }),
  gitlab: vi.fn().mockReturnValue({ verifyAccess: vi.fn() }),
}));

vi.mock("@sweny-ai/providers/coding-agent", () => ({
  claudeCode: vi.fn().mockReturnValue({ install: vi.fn(), run: vi.fn() }),
  openaiCodex: vi.fn().mockReturnValue({ install: vi.fn(), run: vi.fn() }),
  googleGemini: vi.fn().mockReturnValue({ install: vi.fn(), run: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Mock @sweny-ai/providers (main) — for MCPServerConfig type
// ---------------------------------------------------------------------------

vi.mock("@sweny-ai/providers", () => ({}));

// ---------------------------------------------------------------------------
// Import module under test AFTER all mocks are declared
// ---------------------------------------------------------------------------

const { runJob, pendingWorkDirs } = await import("../src/runner.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encryptForBundle(value: string, bek: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", bek, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

function makeEncryptedBundle(credentials: Record<string, string>, bek: Buffer): string {
  const bundle: Record<string, string> = {};
  for (const [k, v] of Object.entries(credentials)) {
    bundle[k] = encryptForBundle(v, bek);
  }
  return JSON.stringify(bundle);
}

const TEST_BEK = randomBytes(32);
const TEST_BEK_HEX = TEST_BEK.toString("hex");
const JOB_TOKEN = "test-job-token-123";
const INTERNAL_API_URL = "http://localhost:3001";

const baseCredentials: Record<string, string> = {
  GITHUB_TOKEN: "ghp_test_token",
  ANTHROPIC_API_KEY: "sk-ant-test",
};

function makePayload(
  overrides: Partial<WorkerJobPayload> = {},
  credentials: Record<string, string> = baseCredentials,
): WorkerJobPayload {
  return {
    jobId: "00000000-0000-0000-0000-000000000001",
    orgId: "org-test",
    jobToken: JOB_TOKEN,
    encryptedBundle: makeEncryptedBundle(credentials, TEST_BEK),
    jobType: "triage",
    repoOwner: "acme",
    repoName: "api",
    defaultBranch: "main",
    config: {},
    ...overrides,
  };
}

function triageResult(overrides?: Partial<WorkflowResult>): WorkflowResult {
  return {
    status: "completed",
    duration: 3000,
    steps: [
      {
        name: "investigate",
        phase: "learn",
        result: {
          status: "success",
          data: { issuesFound: false, recommendation: "skip" },
        },
      },
    ],
    ...overrides,
  };
}

function implementResult(overrides?: Partial<WorkflowResult>): WorkflowResult {
  return {
    status: "completed",
    duration: 8000,
    steps: [
      {
        name: "create-pr",
        phase: "act",
        result: {
          status: "success",
          data: { prUrl: "https://github.com/acme/api/pull/42", issueUrl: "https://linear.app/acme/issue/ENG-99" },
        },
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: mkdtemp returns a stable path inside /tmp
    mockMkdtemp.mockResolvedValue("/tmp/sweny-triage-abc123");
    mockRm.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    // Default: git clone succeeds
    mockExecFile.mockResolvedValue({ stdout: "", stderr: "" });

    // Spy on chdir so we don't actually cd into fake paths
    vi.spyOn(process, "chdir").mockImplementation(() => {});

    // Default: fetch mock handles all internal API calls
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;

      if (url.includes("/secrets")) {
        return new Response(JSON.stringify({ bek: TEST_BEK_HEX }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/start")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/result")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    });
  });

  // -------------------------------------------------------------------------
  // Triage jobs
  // -------------------------------------------------------------------------

  it("runs triageWorkflow for a triage job", async () => {
    mockRunWorkflow.mockResolvedValue(triageResult());

    await runJob(makePayload({ jobType: "triage" }), INTERNAL_API_URL, "claude");

    expect(mockRunWorkflow).toHaveBeenCalledOnce();
    // First arg is triageWorkflow
    expect(mockRunWorkflow.mock.calls[0][0]).toMatchObject({
      definition: expect.objectContaining({ id: "triage" }),
    });
  });

  it("returns a completed triage outcome with recommendation=skip when no issues found", async () => {
    mockRunWorkflow.mockResolvedValue(triageResult());

    const outcome = await runJob(makePayload({ jobType: "triage" }), INTERNAL_API_URL, "claude");

    expect(outcome.jobStatus).toBe("completed");
    expect(outcome.issuesFound).toBe(false);
    expect(outcome.recommendation).toBe("skip");
  });

  it("returns recommendation=implement when investigate step says implement", async () => {
    mockRunWorkflow.mockResolvedValue(
      triageResult({
        steps: [
          {
            name: "investigate",
            phase: "learn",
            result: {
              status: "success",
              data: { issuesFound: true, recommendation: "implement" },
            },
          },
        ],
      }),
    );

    const outcome = await runJob(makePayload({ jobType: "triage" }), INTERNAL_API_URL, "claude");

    expect(outcome.issuesFound).toBe(true);
    expect(outcome.recommendation).toBe("implement");
  });

  // -------------------------------------------------------------------------
  // Implement jobs
  // -------------------------------------------------------------------------

  it("runs implementWorkflow for an implement job", async () => {
    mockMkdtemp.mockResolvedValue("/tmp/sweny-implement-xyz789");
    mockRunWorkflow.mockResolvedValue(implementResult());

    await runJob(
      makePayload({
        jobType: "implement",
        config: { issueIdentifier: "ENG-42" },
      }),
      INTERNAL_API_URL,
      "claude",
    );

    expect(mockRunWorkflow).toHaveBeenCalledOnce();
    // First arg is implementWorkflow
    expect(mockRunWorkflow.mock.calls[0][0]).toMatchObject({
      definition: expect.objectContaining({ id: "implement" }),
    });
  });

  it("returns implement outcome with prUrl and issueIdentifier", async () => {
    mockMkdtemp.mockResolvedValue("/tmp/sweny-implement-xyz789");
    mockRunWorkflow.mockResolvedValue(implementResult());

    const outcome = await runJob(
      makePayload({
        jobType: "implement",
        config: { issueIdentifier: "ENG-42" },
      }),
      INTERNAL_API_URL,
      "claude",
    );

    expect(outcome.recommendation).toBe("implement");
    expect(outcome.prUrl).toBe("https://github.com/acme/api/pull/42");
    expect(outcome.issueIdentifier).toBe("ENG-42");
  });

  it("throws if implement job is missing issueIdentifier in config", async () => {
    mockMkdtemp.mockResolvedValue("/tmp/sweny-implement-xyz789");

    await expect(runJob(makePayload({ jobType: "implement", config: {} }), INTERNAL_API_URL, "claude")).rejects.toThrow(
      "issueIdentifier",
    );
  });

  // -------------------------------------------------------------------------
  // API interactions
  // -------------------------------------------------------------------------

  it("calls /start before any other work", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/start")) calls.push("start");
      else if (url.includes("/secrets")) {
        calls.push("secrets");
        return new Response(JSON.stringify({ bek: TEST_BEK_HEX }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } else if (url.includes("/result")) {
        calls.push("result");
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    mockRunWorkflow.mockResolvedValue(triageResult());

    await runJob(makePayload(), INTERNAL_API_URL, "claude");

    expect(calls[0]).toBe("start");
    expect(calls).toContain("secrets");
    expect(calls).toContain("result");
  });

  it("sends X-Job-Token header to all internal API calls", async () => {
    mockRunWorkflow.mockResolvedValue(triageResult());

    await runJob(makePayload(), INTERNAL_API_URL, "claude");

    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    for (const [, options] of fetchCalls) {
      expect((options as RequestInit).headers).toMatchObject({
        "X-Job-Token": JOB_TOKEN,
      });
    }
  });

  it("submits result to /result endpoint after successful job", async () => {
    mockRunWorkflow.mockResolvedValue(triageResult());

    await runJob(makePayload(), INTERNAL_API_URL, "claude");

    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const resultCall = fetchCalls.find(([input]) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      return url.includes("/result");
    });

    expect(resultCall).toBeDefined();
    const body = JSON.parse((resultCall![1] as RequestInit).body as string);
    expect(body.jobStatus).toBe("completed");
    expect(body.recommendation).toBe("skip");
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it("reports failure to /result when runWorkflow throws", async () => {
    mockRunWorkflow.mockRejectedValue(new Error("Agent crashed"));

    await expect(runJob(makePayload(), INTERNAL_API_URL, "claude")).rejects.toThrow("Agent crashed");

    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const resultCall = fetchCalls.find(([input]) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      return url.includes("/result");
    });

    expect(resultCall).toBeDefined();
    const body = JSON.parse((resultCall![1] as RequestInit).body as string);
    expect(body.jobStatus).toBe("failed");
    expect(body.recommendation).toBe("skip");
  });

  it("throws when secrets API returns non-OK status", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/start")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/secrets")) {
        return new Response("Unauthorized", { status: 401 });
      }
      return new Response("Not found", { status: 404 });
    });

    await expect(runJob(makePayload(), INTERNAL_API_URL, "claude")).rejects.toThrow("401");
  });

  // -------------------------------------------------------------------------
  // workDir cleanup
  // -------------------------------------------------------------------------

  it("cleans up workDir in finally block after success", async () => {
    mockRunWorkflow.mockResolvedValue(triageResult());

    await runJob(makePayload(), INTERNAL_API_URL, "claude");

    expect(mockRm).toHaveBeenCalledWith("/tmp/sweny-triage-abc123", { recursive: true, force: true });
  });

  it("cleans up workDir in finally block even when runWorkflow throws", async () => {
    mockRunWorkflow.mockRejectedValue(new Error("Engine failure"));

    await expect(runJob(makePayload(), INTERNAL_API_URL, "claude")).rejects.toThrow();

    expect(mockRm).toHaveBeenCalledWith("/tmp/sweny-triage-abc123", { recursive: true, force: true });
  });

  it("removes workDir from pendingWorkDirs after completion", async () => {
    mockRunWorkflow.mockResolvedValue(triageResult());

    // pendingWorkDirs should not contain the workDir after the job
    await runJob(makePayload(), INTERNAL_API_URL, "claude");

    expect(pendingWorkDirs.has("/tmp/sweny-triage-abc123")).toBe(false);
  });

  it("removes workDir from pendingWorkDirs even after failure", async () => {
    mockRunWorkflow.mockRejectedValue(new Error("Boom"));

    await expect(runJob(makePayload(), INTERNAL_API_URL, "claude")).rejects.toThrow();

    expect(pendingWorkDirs.has("/tmp/sweny-triage-abc123")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Git clone
  // -------------------------------------------------------------------------

  it("clones the repo before running the workflow", async () => {
    mockRunWorkflow.mockResolvedValue(triageResult());

    await runJob(makePayload(), INTERNAL_API_URL, "claude");

    expect(mockExecFile).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["clone", "--depth", "1", "--branch", "main"]),
      expect.objectContaining({ timeout: 60_000 }),
    );
  });

  it("writes a .git-credentials file (not GITHUB_TOKEN in args)", async () => {
    mockRunWorkflow.mockResolvedValue(triageResult());

    await runJob(makePayload(), INTERNAL_API_URL, "claude");

    // The credentials file is written
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining(".git-credentials"),
      expect.stringContaining("ghp_test_token"),
      expect.objectContaining({ mode: 0o600 }),
    );

    // GITHUB_TOKEN must NOT appear in git clone argv
    const gitArgs = mockExecFile.mock.calls[0][1] as string[];
    const argsStr = gitArgs.join(" ");
    expect(argsStr).not.toContain("ghp_test_token");
  });
});
