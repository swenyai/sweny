import { describe, it, expect } from "vitest";
import { formatDagResultMarkdown } from "./output.js";
import type { NodeResult } from "../types.js";
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
    dryRun: false,
    ...overrides,
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
    expect(md).toContain("**Duration:** 15s");
    expect(md).toContain("**Service filter:** `permit-service`");
    expect(md).toContain("**Highest severity:** high");
    expect(md).toContain("OFF-1234");
    expect(md).toContain("https://linear.app/acme/issue/OFF-1234");
    expect(md).toContain("#42");
    expect(md).toContain("https://github.com/acme/app/pull/42");
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
    expect(md).not.toContain("Pull request");
  });

  it("renders a clean no-incident result when novel_count is 0", () => {
    const results = new Map<string, NodeResult>([["investigate", success({ novel_count: 0 })]]);

    const md = formatDagResultMarkdown(results, 3_000, minimalConfig() as CliConfig);
    expect(md).toContain("## ✅ SWEny Triage — No new incidents");
    expect(md).toContain("**Novel findings:** 0");
  });

  it("renders a findings table in dry-run mode", () => {
    const results = new Map<string, NodeResult>([
      [
        "investigate",
        success({
          novel_count: 2,
          highest_severity: "high",
          findings: [
            { severity: "high", title: "OOM in worker", is_duplicate: false },
            { severity: "low", title: "Stale metric", is_duplicate: true },
          ],
        }),
      ],
    ]);

    const md = formatDagResultMarkdown(results, 9_000, minimalConfig({ dryRun: true }) as CliConfig);

    expect(md).toContain("## 🔍 SWEny Triage — Dry run complete");
    expect(md).toContain("| Severity | Title | Status |");
    expect(md).toContain("| high | OOM in worker | novel |");
    expect(md).toContain("| low | Stale metric | duplicate |");
    expect(md).toContain("_Dry run mode — no side effects were taken._");
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
});
