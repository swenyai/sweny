import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import type { ObservabilityProvider } from "@sweny-ai/providers/observability";
import type { TriageConfig } from "./types.js";
import { buildInvestigationPrompt, buildImplementPrompt, buildPrDescriptionPrompt } from "./prompts.js";
import { defaultConfig } from "./test-helpers.js";
import { parseServiceMap } from "./service-map.js";

// ---------------------------------------------------------------------------
// Mock fs so buildInvestigationPrompt doesn't hit the real filesystem
// ---------------------------------------------------------------------------

vi.mock("fs");

// ---------------------------------------------------------------------------
// Mock parseServiceMap to avoid transitive fs reads
// ---------------------------------------------------------------------------

vi.mock("./service-map.js", () => ({
  parseServiceMap: vi.fn().mockReturnValue({ services: [] }),
}));

const mockedParseServiceMap = vi.mocked(parseServiceMap);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockObservability(instructions = "Use the Datadog Logs API to query logs."): ObservabilityProvider {
  return {
    verifyAccess: vi.fn().mockResolvedValue(undefined),
    queryLogs: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue([]),
    getAgentEnv: vi.fn().mockReturnValue({}),
    getPromptInstructions: vi.fn().mockReturnValue(instructions),
  };
}

function makeConfig(overrides?: Partial<TriageConfig>): TriageConfig {
  return { ...defaultConfig, ...overrides };
}

// ---------------------------------------------------------------------------
// buildInvestigationPrompt
// ---------------------------------------------------------------------------

describe("buildInvestigationPrompt", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default: service map file doesn't exist, parseServiceMap returns empty
    mockedParseServiceMap.mockReturnValue({ services: [] });
  });

  it("includes the repository name", () => {
    const config = makeConfig({ repository: "acme/backend" });
    const result = buildInvestigationPrompt(config, createMockObservability(), "");
    expect(result).toContain("acme/backend");
  });

  it("includes the service filter", () => {
    const config = makeConfig({ serviceFilter: "payments-*" });
    const result = buildInvestigationPrompt(config, createMockObservability(), "");
    expect(result).toContain("payments-*");
  });

  it("includes the time range", () => {
    const config = makeConfig({ timeRange: "24h" });
    const result = buildInvestigationPrompt(config, createMockObservability(), "");
    expect(result).toContain("24h");
  });

  it("includes the severity focus", () => {
    const config = makeConfig({ severityFocus: "critical" });
    const result = buildInvestigationPrompt(config, createMockObservability(), "");
    expect(result).toContain("critical");
  });

  it("includes the investigation depth", () => {
    const config = makeConfig({ investigationDepth: "deep" });
    const result = buildInvestigationPrompt(config, createMockObservability(), "");
    expect(result).toContain("deep");
  });

  it("includes observability provider instructions", () => {
    const obs = createMockObservability("Query Datadog with the following curl commands...");
    const result = buildInvestigationPrompt(makeConfig(), obs, "");
    expect(result).toContain("Query Datadog with the following curl commands...");
  });

  it("includes issue override when provided", () => {
    const config = makeConfig({ issueOverride: "ENG-456" });
    const result = buildInvestigationPrompt(config, createMockObservability(), "");
    expect(result).toContain("ENG-456");
  });

  it("shows placeholder when issue override is empty", () => {
    const config = makeConfig({ issueOverride: "" });
    const result = buildInvestigationPrompt(config, createMockObservability(), "");
    expect(result).toContain("(none provided)");
  });

  it("includes additional instructions when provided", () => {
    const config = makeConfig({
      additionalInstructions: "Focus only on the auth service timeout errors",
    });
    const result = buildInvestigationPrompt(config, createMockObservability(), "");
    expect(result).toContain("Focus only on the auth service timeout errors");
  });

  it("shows placeholder when additional instructions are empty", () => {
    const config = makeConfig({ additionalInstructions: "" });
    const result = buildInvestigationPrompt(config, createMockObservability(), "");
    // The prompt should contain the "(none provided)" placeholder for additional instructions
    // It appears twice — once for issueOverride and once for additionalInstructions
    const matches = result.match(/\(none provided\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it("includes known issues content when provided", () => {
    const knownIssues = "ENG-100: Null pointer in auth handler\nENG-101: Timeout in payment service";
    const result = buildInvestigationPrompt(makeConfig(), createMockObservability(), knownIssues);
    expect(result).toContain("KNOWN ISSUES");
    expect(result).toContain("ENG-100: Null pointer in auth handler");
    expect(result).toContain("ENG-101: Timeout in payment service");
  });

  it("omits known issues section when content is empty", () => {
    const result = buildInvestigationPrompt(makeConfig(), createMockObservability(), "");
    expect(result).not.toContain("KNOWN ISSUES");
  });

  it("includes the service map path for the agent", () => {
    const config = makeConfig({ serviceMapPath: "/repo/service-map.yml" });
    const result = buildInvestigationPrompt(config, createMockObservability(), "");
    expect(result).toContain("/repo/service-map.yml");
  });

  it("includes inline service map content when file exists and services are defined", () => {
    mockedParseServiceMap.mockReturnValue({
      services: [{ name: "api", repo: "org/api", owns: ["src/api/"] }],
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("services:\n  api:\n    repo: org/api\n    owns:\n      - src/api/");

    const config = makeConfig({ serviceMapPath: "/repo/service-map.yml" });
    const result = buildInvestigationPrompt(config, createMockObservability(), "");
    expect(result).toContain("Service Map Reference");
    expect(result).toContain("org/api");
  });

  it("includes output requirements section", () => {
    const result = buildInvestigationPrompt(makeConfig(), createMockObservability(), "");
    expect(result).toContain("Output Requirements");
    expect(result).toContain("best-candidate.md");
    expect(result).toContain("investigation-log.md");
    expect(result).toContain("issues-report.md");
  });

  it("includes target repo identification section", () => {
    const result = buildInvestigationPrompt(makeConfig(), createMockObservability(), "");
    expect(result).toContain("TARGET REPO IDENTIFICATION");
    expect(result).toContain("TARGET_SERVICE");
    expect(result).toContain("TARGET_REPO");
  });

  it("includes TRIAGE_FINGERPRINT instructions", () => {
    const result = buildInvestigationPrompt(makeConfig(), createMockObservability(), "");
    expect(result).toContain("TRIAGE_FINGERPRINT");
  });

  it("includes RECOMMENDATION instructions", () => {
    const result = buildInvestigationPrompt(makeConfig(), createMockObservability(), "");
    expect(result).toContain("RECOMMENDATION: implement");
    expect(result).toContain("RECOMMENDATION: skip");
  });
});

// ---------------------------------------------------------------------------
// buildImplementPrompt
// ---------------------------------------------------------------------------

describe("buildImplementPrompt", () => {
  it("includes the issue identifier", () => {
    const result = buildImplementPrompt("ENG-200");
    expect(result).toContain("ENG-200");
  });

  it("references best-candidate.md for context", () => {
    const result = buildImplementPrompt("ENG-300");
    expect(result).toContain("best-candidate.md");
  });

  it("references investigation-log.md for context", () => {
    const result = buildImplementPrompt("ENG-300");
    expect(result).toContain("investigation-log.md");
  });

  it("includes commit format instructions", () => {
    const result = buildImplementPrompt("ENG-400");
    expect(result).toContain("fix(");
    expect(result).toContain("Identified by SWEny Triage");
  });

  it("includes safety guidelines", () => {
    const result = buildImplementPrompt("ENG-500");
    expect(result).toContain("fix-declined.md");
    expect(result).toContain("breaking changes");
  });

  it("includes verification steps", () => {
    const result = buildImplementPrompt("ENG-600");
    expect(result).toContain("npm run lint");
    expect(result).toContain("npm run build");
  });

  it("embeds the issue identifier in the commit template", () => {
    const result = buildImplementPrompt("PROJ-42");
    expect(result).toContain("PROJ-42");
  });

  it("uses provider-specific label in commit template", () => {
    expect(buildImplementPrompt("ENG-1", ".github/triage-analysis", "linear")).toContain("Linear: ENG-1");
    expect(buildImplementPrompt("#20", ".github/triage-analysis", "github-issues")).toContain("GitHub Issues: #20");
    expect(buildImplementPrompt("PROJ-5", ".github/triage-analysis", "jira")).toContain("Jira: PROJ-5");
  });
});

// ---------------------------------------------------------------------------
// buildPrDescriptionPrompt
// ---------------------------------------------------------------------------

describe("buildPrDescriptionPrompt", () => {
  it("includes the issue identifier", () => {
    const result = buildPrDescriptionPrompt("ENG-700", "https://tracker.example.com/ENG-700");
    expect(result).toContain("ENG-700");
  });

  it("includes the issue URL", () => {
    const result = buildPrDescriptionPrompt("ENG-800", "https://tracker.example.com/ENG-800");
    expect(result).toContain("https://tracker.example.com/ENG-800");
  });

  it("references best-candidate.md for context", () => {
    const result = buildPrDescriptionPrompt("ENG-900", "https://tracker.example.com/ENG-900");
    expect(result).toContain("best-candidate.md");
  });

  it("references investigation-log.md for context", () => {
    const result = buildPrDescriptionPrompt("ENG-900", "https://tracker.example.com/ENG-900");
    expect(result).toContain("investigation-log.md");
  });

  it("instructs to create pr-description.md", () => {
    const result = buildPrDescriptionPrompt("ENG-1000", "https://tracker.example.com/ENG-1000");
    expect(result).toContain("pr-description.md");
  });

  it("includes git diff instruction for viewing changes", () => {
    const result = buildPrDescriptionPrompt("ENG-1100", "https://tracker.example.com/ENG-1100");
    expect(result).toContain("git diff");
  });

  it("includes standard PR sections", () => {
    const result = buildPrDescriptionPrompt("ENG-1200", "https://tracker.example.com/ENG-1200");
    expect(result).toContain("Summary");
    expect(result).toContain("Root Cause");
    expect(result).toContain("Solution");
    expect(result).toContain("Rollback Plan");
  });

  it("includes SWEny attribution", () => {
    const result = buildPrDescriptionPrompt("ENG-1300", "https://tracker.example.com/ENG-1300");
    expect(result).toContain("SWEny Triage");
  });

  it("returns a non-empty string", () => {
    const result = buildPrDescriptionPrompt("ENG-1400", "https://tracker.example.com/ENG-1400");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
