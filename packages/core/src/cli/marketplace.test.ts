import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  fetchMarketplaceWorkflow,
  fetchMarketplaceIndex,
  computeProviderMismatch,
  buildAdaptPrompt,
  adaptWorkflowInteractive,
  installMarketplaceWorkflow,
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

describe("installMarketplaceWorkflow", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
    vi.restoreAllMocks();
  });

  function tmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-install-"));
    tmpDirs.push(dir);
    return dir;
  }

  const sampleYaml =
    "id: pr-review\nname: PR Review\ndescription: Review PRs\nentry: start\n" +
    "nodes:\n  start:\n    name: Start\n    instruction: hi\n    skills: [github]\nedges: []\n";

  it("installs workflow as-is when no mismatch and no .sweny.yml", async () => {
    const cwd = tmp();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(sampleYaml, { status: 200 }));

    const result = await installMarketplaceWorkflow("pr-review", {
      cwd,
      availableSkills: testSkills,
      claude: null,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.installed).toBe(true);
    expect(result.adapted).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".sweny.yml"))).toBe(true);
    expect(fs.existsSync(path.join(cwd, ".sweny", "workflows", "pr-review.yml"))).toBe(true);
  });

  it("warns and installs as-is when mismatch detected but no agent", async () => {
    const cwd = tmp();
    fs.writeFileSync(path.join(cwd, ".sweny.yml"), "issue-tracker-provider: github-issues\n");
    const yamlWithLinear = sampleYaml.replace("[github]", "[linear]");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(yamlWithLinear, { status: 200 }));

    const warnings: string[] = [];
    const result = await installMarketplaceWorkflow("pr-review", {
      cwd,
      availableSkills: testSkills,
      claude: null,
      logger: {
        debug: () => {},
        info: () => {},
        warn: (m: string) => warnings.push(m),
        error: () => {},
      },
    });

    expect(result.installed).toBe(true);
    expect(result.adapted).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(warnings.some((w) => w.includes("linear"))).toBe(true);
  });

  it("throws with not-found kind when workflow missing", async () => {
    const cwd = tmp();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 404 }));

    await expect(
      installMarketplaceWorkflow("nope", {
        cwd,
        availableSkills: testSkills,
        claude: null,
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      }),
    ).rejects.toMatchObject({ kind: "not-found" });
  });

  // ── I1: pre-computed provider inference ────────────────────────────────

  it("uses inferredSourceControl instead of skill-based inference for .sweny.yml", async () => {
    // Workflow references github skill, but caller says the remote is gitlab.
    // The written .sweny.yml must say gitlab, not github.
    const cwd = tmp();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(sampleYaml, { status: 200 }));

    await installMarketplaceWorkflow("pr-review", {
      cwd,
      availableSkills: testSkills,
      claude: null,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      inferredSourceControl: "gitlab",
      inferredIssueTracker: "github-issues",
      inferredObservability: null,
    });

    const swenyYml = fs.readFileSync(path.join(cwd, ".sweny.yml"), "utf-8");
    expect(swenyYml).toContain("source-control-provider: gitlab");
    // skill-based fallback would have written "github" — verify it did NOT
    expect(swenyYml).not.toContain("source-control-provider: github");
  });

  it("falls back to skill-based inference when inferredSourceControl is absent", async () => {
    // Workflow references github skill, no pre-computed values → should infer github
    const cwd = tmp();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(sampleYaml, { status: 200 }));

    await installMarketplaceWorkflow("pr-review", {
      cwd,
      availableSkills: testSkills,
      claude: null,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    const swenyYml = fs.readFileSync(path.join(cwd, ".sweny.yml"), "utf-8");
    expect(swenyYml).toContain("source-control-provider: github");
  });

  // ── I2: overwrite protection ────────────────────────────────────────────

  it("returns alreadyExists=true without overwriting when overwrite is false (default)", async () => {
    const cwd = tmp();
    // Pre-create the workflow file with distinct content
    const wfDir = path.join(cwd, ".sweny", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    const wfPath = path.join(wfDir, "pr-review.yml");
    fs.writeFileSync(wfPath, "# original content\n", "utf-8");

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(sampleYaml, { status: 200 }));

    const result = await installMarketplaceWorkflow("pr-review", {
      cwd,
      availableSkills: testSkills,
      claude: null,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      // overwrite: false is the default — omitting it intentionally
    });

    expect(result.installed).toBe(false);
    expect(result.alreadyExists).toBe(true);
    expect(result.workflowPath).toBe(wfPath);
    // File must be unchanged
    expect(fs.readFileSync(wfPath, "utf-8")).toBe("# original content\n");
  });

  it("overwrites existing workflow file when overwrite is true", async () => {
    const cwd = tmp();
    // Pre-create the workflow file with stale content
    const wfDir = path.join(cwd, ".sweny", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    const wfPath = path.join(wfDir, "pr-review.yml");
    fs.writeFileSync(wfPath, "# stale content\n", "utf-8");

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(sampleYaml, { status: 200 }));

    const result = await installMarketplaceWorkflow("pr-review", {
      cwd,
      availableSkills: testSkills,
      claude: null,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      overwrite: true,
    });

    expect(result.installed).toBe(true);
    expect(result.alreadyExists).toBeUndefined();
    // File must contain the new content
    const written = fs.readFileSync(wfPath, "utf-8");
    expect(written).toContain("PR Review");
    expect(written).not.toContain("stale content");
  });

  // Fix #3: marketplace fetches must be validated BEFORE any local side
  // effects. Previously installMarketplaceWorkflow only ran Zod validation
  // inside the "adapt" branch, so invalid fetched content could still be
  // written as-is AND pollute .sweny.yml / .env with skill keys from the
  // broken workflow.
  describe("install rejects invalid marketplace content", () => {
    it("aborts when fetched YAML is not parseable", async () => {
      const cwd = tmp();
      vi.spyOn(globalThis, "fetch").mockImplementation(
        async () => new Response("id: x\nnodes:\n  a: {name: [unclosed", { status: 200 }),
      );

      await expect(
        installMarketplaceWorkflow("broken", {
          cwd,
          availableSkills: testSkills,
          claude: null,
          logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
        }),
      ).rejects.toThrow();

      // Nothing should have been written to the user's project.
      expect(fs.existsSync(path.join(cwd, ".sweny.yml"))).toBe(false);
      expect(fs.existsSync(path.join(cwd, ".sweny", "workflows", "broken.yml"))).toBe(false);
    });

    it("aborts when fetched YAML is valid YAML but fails schema (missing entry)", async () => {
      const cwd = tmp();
      const bad =
        "id: bad\nname: Bad\ndescription: d\n" +
        "nodes:\n  a:\n    name: A\n    instruction: hi\n    skills: []\nedges: []\n";
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(bad, { status: 200 }));

      await expect(
        installMarketplaceWorkflow("bad", {
          cwd,
          availableSkills: testSkills,
          claude: null,
          logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
        }),
      ).rejects.toThrow();

      expect(fs.existsSync(path.join(cwd, ".sweny.yml"))).toBe(false);
      expect(fs.existsSync(path.join(cwd, ".sweny", "workflows", "bad.yml"))).toBe(false);
    });
  });
});
