import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchMarketplaceWorkflow,
  fetchMarketplaceIndex,
  computeProviderMismatch,
  buildAdaptPrompt,
  adaptWorkflowInteractive,
  MARKETPLACE_RAW_BASE,
} from "./marketplace.js";
import type { Skill, Workflow } from "../types.js";

vi.mock("@clack/prompts", () => ({
  select: vi.fn(),
  text: vi.fn(),
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  log: { message: vi.fn(), error: vi.fn() },
  isCancel: (v: unknown) => v === Symbol.for("cancel"),
}));
vi.mock("../workflow-builder.js", () => ({
  refineWorkflow: vi.fn(),
}));

describe("fetchMarketplaceWorkflow", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("id: pr-review\nname: PR Review\n", { status: 200 });
    });
  });
  afterEach(() => fetchSpy.mockRestore());

  it("fetches workflow YAML from raw GitHub", async () => {
    const result = await fetchMarketplaceWorkflow("pr-review");
    expect(result.id).toBe("pr-review");
    expect(result.yaml).toContain("id: pr-review");
    expect(fetchSpy).toHaveBeenCalledWith(`${MARKETPLACE_RAW_BASE}/workflows/pr-review.yml`);
  });
});

describe("fetchMarketplaceWorkflow errors", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  afterEach(() => fetchSpy?.mockRestore());

  it("throws not-found on 404", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 404 }));
    await expect(fetchMarketplaceWorkflow("missing")).rejects.toMatchObject({
      kind: "not-found",
      message: expect.stringContaining("missing"),
    });
  });

  it("throws rate-limit on 403 with X-RateLimit-Remaining: 0", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response("", {
          status: 403,
          headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1234567890" },
        }),
    );
    await expect(fetchMarketplaceWorkflow("pr-review")).rejects.toMatchObject({
      kind: "rate-limit",
      retryAfter: 1234567890,
    });
  });

  it("throws network error when fetch rejects", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(fetchMarketplaceWorkflow("pr-review")).rejects.toMatchObject({
      kind: "network",
    });
  });
});

describe("fetchMarketplaceIndex", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fetches and parses index.json", async () => {
    const body = JSON.stringify([
      { id: "pr-review", name: "PR Review", description: "Reviews PRs", skills: ["github"] },
      { id: "issue-triage", name: "Issue Triage", description: "Triages issues", skills: ["github"] },
    ]);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(body, { status: 200 }));

    const entries = await fetchMarketplaceIndex();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: "pr-review", name: "PR Review" });
  });

  it("throws not-found when index.json is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 404 }));
    await expect(fetchMarketplaceIndex()).rejects.toMatchObject({ kind: "not-found" });
  });
});

const testSkills: Skill[] = [
  { id: "linear", name: "Linear", description: "", category: "tasks", config: {}, tools: [] },
  {
    id: "github-issues",
    name: "GitHub Issues",
    description: "",
    category: "tasks",
    config: {},
    tools: [],
  },
  { id: "github", name: "GitHub", description: "", category: "git", config: {}, tools: [] },
  {
    id: "datadog",
    name: "Datadog",
    description: "",
    category: "observability",
    config: {},
    tools: [],
  },
  { id: "sentry", name: "Sentry", description: "", category: "observability", config: {}, tools: [] },
];

describe("computeProviderMismatch", () => {
  it("returns empty array when all workflow skills match config", () => {
    const mismatches = computeProviderMismatch(
      ["github", "github-issues"],
      { "source-control-provider": "github", "issue-tracker-provider": "github-issues" },
      testSkills,
    );
    expect(mismatches).toEqual([]);
  });

  it("detects tasks mismatch (workflow=linear, config=github-issues)", () => {
    const mismatches = computeProviderMismatch(["linear"], { "issue-tracker-provider": "github-issues" }, testSkills);
    expect(mismatches).toEqual([
      {
        category: "tasks",
        configKey: "issue-tracker-provider",
        workflowSkill: "linear",
        userProvider: "github-issues",
      },
    ]);
  });

  it("detects observability mismatch and ignores general-category skills", () => {
    const mismatches = computeProviderMismatch(["datadog"], { "observability-provider": "sentry" }, testSkills);
    expect(mismatches).toEqual([
      {
        category: "observability",
        configKey: "observability-provider",
        workflowSkill: "datadog",
        userProvider: "sentry",
      },
    ]);
  });

  it("skips mismatch when the user has no provider set for that role", () => {
    const mismatches = computeProviderMismatch(["linear"], {}, testSkills);
    expect(mismatches).toEqual([]);
  });

  it("ignores workflow skills not in the available skill registry", () => {
    const mismatches = computeProviderMismatch(
      ["unknown-skill"],
      { "issue-tracker-provider": "github-issues" },
      testSkills,
    );
    expect(mismatches).toEqual([]);
  });
});

describe("buildAdaptPrompt", () => {
  it("describes single mismatch", () => {
    const prompt = buildAdaptPrompt([
      {
        category: "tasks",
        configKey: "issue-tracker-provider",
        workflowSkill: "linear",
        userProvider: "github-issues",
      },
    ]);
    expect(prompt).toContain("linear");
    expect(prompt).toContain("github-issues");
    expect(prompt).toContain("issue-tracker");
    expect(prompt.toLowerCase()).toContain("rewrite");
  });

  it("describes multiple mismatches", () => {
    const prompt = buildAdaptPrompt([
      {
        category: "tasks",
        configKey: "issue-tracker-provider",
        workflowSkill: "linear",
        userProvider: "github-issues",
      },
      {
        category: "observability",
        configKey: "observability-provider",
        workflowSkill: "datadog",
        userProvider: "sentry",
      },
    ]);
    expect(prompt).toContain("linear");
    expect(prompt).toContain("datadog");
    expect(prompt).toContain("sentry");
  });
});

describe("adaptWorkflowInteractive", () => {
  beforeEach(() => vi.clearAllMocks());

  const sampleWorkflow: Workflow = {
    id: "pr-review",
    name: "PR Review",
    description: "",
    entry: "start",
    nodes: { start: { name: "Start", instruction: "x", skills: [] } },
    edges: [],
  };

  it("returns the workflow when user accepts on first render", async () => {
    const p = await import("@clack/prompts");
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("accept");

    const claudeStub = { run: vi.fn() } as any;
    const result = await adaptWorkflowInteractive(sampleWorkflow, {
      claude: claudeStub,
      skills: [],
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result).toEqual(sampleWorkflow);
  });

  it("returns null when user cancels", async () => {
    const p = await import("@clack/prompts");
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("cancel");

    const claudeStub = { run: vi.fn() } as any;
    const result = await adaptWorkflowInteractive(sampleWorkflow, {
      claude: claudeStub,
      skills: [],
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result).toBeNull();
  });

  it("calls refineWorkflow when user picks 'refine'", async () => {
    const p = await import("@clack/prompts");
    const wb = await import("../workflow-builder.js");
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("refine").mockResolvedValueOnce("accept");
    (p.text as ReturnType<typeof vi.fn>).mockResolvedValueOnce("make it better");
    (wb.refineWorkflow as ReturnType<typeof vi.fn>).mockResolvedValueOnce(sampleWorkflow);

    const claudeStub = { run: vi.fn() } as any;
    const result = await adaptWorkflowInteractive(sampleWorkflow, {
      claude: claudeStub,
      skills: [],
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(wb.refineWorkflow).toHaveBeenCalledWith(sampleWorkflow, "make it better", expect.any(Object));
    expect(result).toEqual(sampleWorkflow);
  });
});
