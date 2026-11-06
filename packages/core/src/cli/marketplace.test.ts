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
  MARKETPLACE_REPO,
  MARKETPLACE_TREE_URL,
} from "./marketplace.js";
import { parse as parseYaml } from "yaml";
import { validateParsed } from "../loader.js";
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

/** Mock fetch by URL against the real swenyai/marketplace layout. Unlisted URLs 404. */
function mockFetchByUrl(routes: Record<string, string | Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const hit = routes[String(input)];
    if (hit === undefined) return new Response("", { status: 404 });
    return hit instanceof Response ? hit : new Response(hit, { status: 200 });
  });
}

const officialUrl = (id: string) => `${MARKETPLACE_RAW_BASE}/workflows/official/${id}.yml`;
const communityUrl = (id: string) => `${MARKETPLACE_RAW_BASE}/workflows/community/${id}.yml`;

describe("marketplace location", () => {
  it("points at the real swenyai/marketplace repo layout", () => {
    expect(MARKETPLACE_REPO).toBe("swenyai/marketplace");
    expect(MARKETPLACE_RAW_BASE).toBe("https://raw.githubusercontent.com/swenyai/marketplace/main");
    expect(MARKETPLACE_TREE_URL).toBe("https://api.github.com/repos/swenyai/marketplace/git/trees/main?recursive=1");
  });
});

describe("fetchMarketplaceWorkflow", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fetches an official workflow from workflows/official/<id>.yml", async () => {
    const spy = mockFetchByUrl({ [officialUrl("triage")]: "id: triage\nname: Alert Triage\n" });
    const result = await fetchMarketplaceWorkflow("triage");
    expect(result.id).toBe("triage");
    expect(result.yaml).toContain("id: triage");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(officialUrl("triage"));
  });

  it("falls back to workflows/community/<id>.yml when not official", async () => {
    const spy = mockFetchByUrl({ [communityUrl("pr-review-bot")]: "id: pr-review-bot\n" });
    const result = await fetchMarketplaceWorkflow("pr-review-bot");
    expect(result.yaml).toContain("pr-review-bot");
    expect(spy.mock.calls.map((c) => c[0])).toEqual([officialUrl("pr-review-bot"), communityUrl("pr-review-bot")]);
  });

  it("rejects ids that could escape the workflows directory without fetching", async () => {
    const spy = mockFetchByUrl({});
    await expect(fetchMarketplaceWorkflow("../site/secrets")).rejects.toMatchObject({ kind: "not-found" });
    await expect(fetchMarketplaceWorkflow("a/b")).rejects.toMatchObject({ kind: "not-found" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("fetchMarketplaceWorkflow errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("throws not-found when neither directory has the workflow", async () => {
    mockFetchByUrl({});
    await expect(fetchMarketplaceWorkflow("missing")).rejects.toMatchObject({
      kind: "not-found",
      message: expect.stringContaining("missing"),
    });
  });

  it("throws rate-limit on 403 with X-RateLimit-Remaining: 0", async () => {
    mockFetchByUrl({
      [officialUrl("triage")]: new Response("", {
        status: 403,
        headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1234567890" },
      }),
    });
    await expect(fetchMarketplaceWorkflow("triage")).rejects.toMatchObject({
      kind: "rate-limit",
      retryAfter: 1234567890,
    });
  });

  it("throws unknown on a non-404 server error instead of trying the next directory", async () => {
    const spy = mockFetchByUrl({ [officialUrl("triage")]: new Response("", { status: 500 }) });
    await expect(fetchMarketplaceWorkflow("triage")).rejects.toMatchObject({ kind: "unknown" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("throws network error when fetch rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(fetchMarketplaceWorkflow("triage")).rejects.toMatchObject({ kind: "network" });
  });
});

describe("fetchMarketplaceIndex", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GITHUB_TOKEN;
  });

  // Mirrors the real repo: workflows/{official,community}/*.yml plus unrelated files.
  const tree = JSON.stringify({
    truncated: false,
    tree: [
      { path: "README.md", type: "blob" },
      { path: "workflows", type: "tree" },
      { path: "workflows/community", type: "tree" },
      { path: "workflows/community/pr-review-bot.yml", type: "blob" },
      { path: "workflows/community/triage.yml", type: "blob" },
      { path: "workflows/official", type: "tree" },
      { path: "workflows/official/triage.yml", type: "blob" },
      { path: "workflows/official/release-notes.yml", type: "blob" },
      { path: "workflows/official/broken.yml", type: "blob" },
      { path: "workflows/official/notes.md", type: "blob" },
      { path: "site/workflows/ignored.yml", type: "blob" },
    ],
  });
  const triageYaml = `id: triage
name: Alert Triage
description: Investigate a production alert
entry: prepare
nodes:
  prepare:
    name: Prepare
    instruction: x
    skills: [github, sentry]
  fix:
    name: Fix
    instruction: y
    skills: [github, linear]
`;

  it("builds entries from workflows/official and workflows/community, official first", async () => {
    mockFetchByUrl({
      [MARKETPLACE_TREE_URL]: tree,
      [officialUrl("triage")]: triageYaml,
      [officialUrl("release-notes")]: "id: release-notes\nname: Release Notes\ndescription: Draft notes\nnodes: {}\n",
      [officialUrl("broken")]: ": : not yaml [",
      [communityUrl("pr-review-bot")]: "id: pr-review-bot\nname: PR Review Bot\ndescription: Reviews PRs\n",
      [communityUrl("triage")]: "id: triage\nname: Community Triage\n",
    });

    const entries = await fetchMarketplaceIndex();
    expect(entries.map((e) => e.id)).toEqual(["triage", "release-notes", "pr-review-bot"]);
    expect(entries[0]).toEqual({
      id: "triage",
      name: "Alert Triage",
      description: "Investigate a production alert",
      skills: ["github", "sentry", "linear"],
    });
    expect(entries[2]).toMatchObject({ name: "PR Review Bot", description: "Reviews PRs", skills: [] });
  });

  it("falls back to the id when a workflow has no name", async () => {
    mockFetchByUrl({
      [MARKETPLACE_TREE_URL]: JSON.stringify({ tree: [{ path: "workflows/official/x.yml", type: "blob" }] }),
      [officialUrl("x")]: "id: x\n",
    });
    expect(await fetchMarketplaceIndex()).toEqual([{ id: "x", name: "x", description: "", skills: [] }]);
  });

  it("returns an empty list when the repo has no workflows", async () => {
    mockFetchByUrl({ [MARKETPLACE_TREE_URL]: JSON.stringify({ tree: [{ path: "README.md", type: "blob" }] }) });
    expect(await fetchMarketplaceIndex()).toEqual([]);
  });

  it("passes an abort signal on every request when a timeout is requested", async () => {
    const spy = mockFetchByUrl({
      [MARKETPLACE_TREE_URL]: JSON.stringify({ tree: [{ path: "workflows/official/x.yml", type: "blob" }] }),
      [officialUrl("x")]: "id: x\n",
    });
    await fetchMarketplaceIndex({ timeoutMs: 3000 });
    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) expect((call[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("sends GITHUB_TOKEN to the GitHub API only, never to raw.githubusercontent.com", async () => {
    process.env.GITHUB_TOKEN = "tok";
    const spy = mockFetchByUrl({
      [MARKETPLACE_TREE_URL]: JSON.stringify({ tree: [{ path: "workflows/official/x.yml", type: "blob" }] }),
      [officialUrl("x")]: "id: x\n",
    });
    await fetchMarketplaceIndex();
    const treeCall = spy.mock.calls.find((c) => c[0] === MARKETPLACE_TREE_URL)!;
    expect((treeCall[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
    const rawCall = spy.mock.calls.find((c) => c[0] === officialUrl("x"))!;
    expect(JSON.stringify(rawCall[1] ?? {})).not.toContain("tok");
  });

  it("throws not-found when the repo is missing", async () => {
    mockFetchByUrl({});
    await expect(fetchMarketplaceIndex()).rejects.toMatchObject({ kind: "not-found" });
  });

  it("throws rate-limit when the GitHub API quota is spent", async () => {
    mockFetchByUrl({
      [MARKETPLACE_TREE_URL]: new Response("", {
        status: 403,
        headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "99" },
      }),
    });
    await expect(fetchMarketplaceIndex()).rejects.toMatchObject({ kind: "rate-limit", retryAfter: 99 });
  });

  it("throws bad-yaml when the tree listing is malformed", async () => {
    mockFetchByUrl({ [MARKETPLACE_TREE_URL]: JSON.stringify({ message: "nope" }) });
    await expect(fetchMarketplaceIndex()).rejects.toMatchObject({ kind: "bad-yaml" });
  });
});

// Opt-in contract test against the live swenyai/marketplace repo. This is what
// would have caught the CLI pointing at a repo that does not exist.
//   SWENY_LIVE_MARKETPLACE=1 npx vitest run packages/core/src/cli/marketplace.test.ts
describe.skipIf(!process.env.SWENY_LIVE_MARKETPLACE)("live swenyai/marketplace contract", () => {
  it("lists workflows and installs one by id", async () => {
    const entries = await fetchMarketplaceIndex();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
      expect(e.name).toBeTruthy();
    }
    const fetched = await fetchMarketplaceWorkflow(entries[0].id);
    const validated = validateParsed(parseYaml(fetched.yaml));
    expect(validated.ok).toBe(true);
  }, 30_000);
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
