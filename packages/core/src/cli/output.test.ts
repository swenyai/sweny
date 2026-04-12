import { describe, it, expect } from "vitest";
import { formatDagResultMarkdown } from "./output.js";
import { triageWorkflow } from "../workflows/index.js";
import type { NodeResult, ExecutionTrace, Workflow } from "../types.js";
import type { CliConfig } from "./config.js";

function success(data: Record<string, unknown> = {}): NodeResult {
  return { status: "success", data, toolCalls: [] };
}

function failed(data: Record<string, unknown> = {}): NodeResult {
  return { status: "failed", data, toolCalls: [] };
}

function minimalConfig(overrides: Partial<CliConfig> = {}): Partial<CliConfig> {
  return {
    timeRange: "6h",
    serviceFilter: "permit-service",
    repository: "acme/app",
    observabilityProvider: "betterstack",
    issueTrackerProvider: "linear",
    dryRun: false,
    ...overrides,
  };
}

/** Build a minimal fake workflow for tests that don't need the full triage graph. */
function fakeWorkflow(): Workflow {
  return {
    id: "test",
    name: "Test Workflow",
    description: "Minimal fixture for output.test.ts — not a real DAG.",
    entry: "investigate",
    nodes: {
      investigate: { name: "Investigate", instruction: "noop", skills: [] },
      create_issue: { name: "Create Issue", instruction: "noop", skills: [] },
      create_pr: { name: "Open PR", instruction: "noop", skills: [] },
    },
    edges: [
      { from: "investigate", to: "create_issue" },
      { from: "create_issue", to: "create_pr" },
    ],
  };
}

function fakeTrace(steps: Array<{ node: string; iteration?: number }>): ExecutionTrace {
  return {
    steps: steps.map((s) => ({
      node: s.node,
      status: "success" as const,
      iteration: s.iteration ?? 1,
    })),
    edges: [],
    sources: {},
  };
}

describe("formatDagResultMarkdown", () => {
  it("renders a success header with issue + PR when both exist", () => {
    const results = new Map<string, NodeResult>([
      [
        "investigate",
        success({ novel_count: 1, highest_severity: "high", findings: [{ severity: "high", title: "500 on /parse" }] }),
      ],
      [
        "create_issue",
        success({
          issueIdentifier: "OFF-1234",
          issueTitle: "Parse failure",
          issueUrl: "https://linear.app/acme/issue/OFF-1234",
        }),
      ],
      ["create_pr", success({ prNumber: 42, prUrl: "https://github.com/acme/app/pull/42" })],
    ]);

    const md = formatDagResultMarkdown(results, 15_000, minimalConfig() as CliConfig);

    expect(md).toContain("## ✅ SWEny Triage — PR opened");
    expect(md).toContain("| Duration | 15s |");
    expect(md).toContain("| Service filter | `permit-service` |");
    expect(md).toContain("| Highest severity | high |");
    expect(md).toContain("OFF-1234");
    expect(md).toContain("https://linear.app/acme/issue/OFF-1234");
    expect(md).toContain("#42");
    expect(md).toContain("https://github.com/acme/app/pull/42");
    expect(md).toContain("**Issue created:**");
    expect(md).toContain("**PR opened:**");
  });

  it("renders an issue-only result when no PR was opened", () => {
    const results = new Map<string, NodeResult>([
      ["investigate", success({ novel_count: 1, highest_severity: "medium" })],
      [
        "create_issue",
        success({ issueIdentifier: "OFF-5", issueTitle: "Investigate warning", issueUrl: "https://linear.app/x/5" }),
      ],
    ]);

    const md = formatDagResultMarkdown(results, 5_000, minimalConfig() as CliConfig);
    expect(md).toContain("## ✅ SWEny Triage — Issue created");
    expect(md).toContain("OFF-5");
    expect(md).not.toContain("**PR opened:**");
  });

  it("renders a clean no-incident result when novel_count is 0", () => {
    const results = new Map<string, NodeResult>([["investigate", success({ novel_count: 0 })]]);

    const md = formatDagResultMarkdown(results, 3_000, minimalConfig() as CliConfig);
    expect(md).toContain("## ✅ SWEny Triage — No new incidents");
    expect(md).toContain("| Novel findings | 0 |");
  });

  it("renders a findings table in dry-run mode", () => {
    const results = new Map<string, NodeResult>([
      [
        "investigate",
        success({
          novel_count: 2,
          highest_severity: "high",
          findings: [
            { severity: "high", title: "OOM in worker", is_duplicate: false, fix_complexity: "medium" },
            { severity: "low", title: "Stale metric", is_duplicate: true, duplicate_of: "OFF-99" },
          ],
        }),
      ],
    ]);

    const md = formatDagResultMarkdown(results, 9_000, minimalConfig({ dryRun: true }) as CliConfig);

    expect(md).toContain("## 🔍 SWEny Triage — Dry run complete");
    expect(md).toContain("| # | Severity | Title | Complexity | Status |");
    expect(md).toContain("| 1 | high | OOM in worker | medium | novel |");
    expect(md).toContain("| 2 | low | Stale metric | — | dup of OFF-99 |");
    expect(md).toContain("_Dry run mode — no side effects were taken._");
    expect(md).toContain("| Mode | dry run |");
  });

  it("renders a failure summary when a node failed", () => {
    const results = new Map<string, NodeResult>([
      ["gather", success()],
      ["investigate", failed({ error: "Rate limited by Anthropic API" })],
    ]);

    const md = formatDagResultMarkdown(results, 2_000, minimalConfig() as CliConfig);
    expect(md).toContain("## ❌ SWEny Triage Failed");
    expect(md).toContain("**Failed at:** `investigate`");
    expect(md).toContain("Rate limited by Anthropic API");
  });

  it("escapes pipe characters in finding titles so the table stays valid", () => {
    const results = new Map<string, NodeResult>([
      [
        "investigate",
        success({
          novel_count: 1,
          findings: [{ severity: "high", title: "broken | pipe | title" }],
        }),
      ],
    ]);

    const md = formatDagResultMarkdown(results, 1_000, minimalConfig({ dryRun: true }) as CliConfig);
    expect(md).toContain("broken \\| pipe \\| title");
  });

  it("embeds a mermaid workflow diagram when workflow is supplied", () => {
    const results = new Map<string, NodeResult>([
      ["investigate", success({ novel_count: 0 })],
      ["create_issue", success({ issueIdentifier: "OFF-7", issueUrl: "https://linear.app/x/7" })],
    ]);

    const workflow = fakeWorkflow();
    const md = formatDagResultMarkdown(results, 4_000, minimalConfig() as CliConfig, { workflow });

    expect(md).toContain("```mermaid");
    expect(md).toContain("graph TB");
    expect(md).toContain("title: Test Workflow");
    // Status classes should be applied for nodes that ran successfully
    expect(md).toContain("class investigate,create_issue success");
  });

  it("renders the workflow path and iteration counts from the execution trace", () => {
    const results = new Map<string, NodeResult>([
      ["investigate", success({ novel_count: 1 })],
      ["create_issue", success({ issueIdentifier: "OFF-8" })],
    ]);

    const workflow = fakeWorkflow();
    const trace = fakeTrace([
      { node: "investigate" },
      { node: "create_issue" },
      { node: "create_issue", iteration: 2 },
    ]);

    const md = formatDagResultMarkdown(results, 8_000, minimalConfig() as CliConfig, { workflow, trace });

    expect(md).toContain("**Workflow path:** `investigate` → `create_issue` → `create_issue ×2`");
  });

  it("accepts the real triageWorkflow without throwing", () => {
    // Regression guard: the real workflow must serialise cleanly through toMermaidBlock
    // so we do not ship a broken diagram to every downstream consumer.
    const results = new Map<string, NodeResult>([["investigate", success({ novel_count: 0 })]]);
    const md = formatDagResultMarkdown(results, 1_000, minimalConfig() as CliConfig, {
      workflow: triageWorkflow,
    });
    expect(md).toContain("```mermaid");
    expect(md).toContain(`title: ${triageWorkflow.name}`);
  });
});
