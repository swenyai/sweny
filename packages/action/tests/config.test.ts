import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetInput, mockGetBooleanInput } = vi.hoisted(() => ({
  mockGetInput: vi.fn(),
  mockGetBooleanInput: vi.fn(),
}));

vi.mock("@actions/core", () => ({
  getInput: mockGetInput,
  getBooleanInput: mockGetBooleanInput,
}));

import { parseInputs } from "../src/config.js";

describe("parseInputs", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockGetInput.mockReset();
    mockGetBooleanInput.mockReset();
    process.env = { ...originalEnv };
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_REPOSITORY_OWNER;
  });

  it("returns all defaults when inputs are empty strings", () => {
    mockGetInput.mockReturnValue("");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.observabilityProvider).toBe("datadog");
    expect(config.observabilityCredentials.site).toBe("datadoghq.com");
    expect(config.issueTrackerProvider).toBe("linear");
    expect(config.timeRange).toBe("24h");
    expect(config.severityFocus).toBe("errors");
    expect(config.serviceFilter).toBe("*");
    expect(config.investigationDepth).toBe("standard");
    expect(config.maxInvestigateTurns).toBe(50);
    expect(config.maxImplementTurns).toBe(30);
    expect(config.serviceMapPath).toBe(".github/service-map.yml");
  });

  it("passes through non-default values when provided", () => {
    const inputMap: Record<string, string> = {
      "observability-provider": "grafana",
      "dd-site": "datadoghq.eu",
      "issue-tracker-provider": "jira",
      "time-range": "1h",
      "severity-focus": "warnings",
      "service-filter": "api-*",
      "investigation-depth": "deep",
      "max-investigate-turns": "100",
      "max-implement-turns": "60",
      "service-map-path": "custom/map.yml",
      "anthropic-api-key": "sk-ant-test",
      "linear-api-key": "lin_test",
    };
    mockGetInput.mockImplementation((name: string) => inputMap[name] ?? "");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.observabilityProvider).toBe("grafana");
    expect(config.observabilityCredentials).toEqual({});  // "grafana" is unknown, returns empty
    expect(config.issueTrackerProvider).toBe("jira");
    expect(config.timeRange).toBe("1h");
    expect(config.severityFocus).toBe("warnings");
    expect(config.serviceFilter).toBe("api-*");
    expect(config.investigationDepth).toBe("deep");
    expect(config.maxInvestigateTurns).toBe(100);
    expect(config.maxImplementTurns).toBe(60);
    expect(config.serviceMapPath).toBe("custom/map.yml");
    expect(config.anthropicApiKey).toBe("sk-ant-test");
    expect(config.linearApiKey).toBe("lin_test");
  });

  it("parses maxInvestigateTurns and maxImplementTurns as integers", () => {
    const inputMap: Record<string, string> = {
      "max-investigate-turns": "75",
      "max-implement-turns": "42",
    };
    mockGetInput.mockImplementation((name: string) => inputMap[name] ?? "");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.maxInvestigateTurns).toBe(75);
    expect(typeof config.maxInvestigateTurns).toBe("number");
    expect(config.maxImplementTurns).toBe(42);
    expect(typeof config.maxImplementTurns).toBe("number");
  });

  it("reads GITHUB_REPOSITORY and GITHUB_REPOSITORY_OWNER from process.env", () => {
    mockGetInput.mockReturnValue("");
    mockGetBooleanInput.mockReturnValue(false);
    process.env.GITHUB_REPOSITORY = "swenyai/sweny";
    process.env.GITHUB_REPOSITORY_OWNER = "swenyai";

    const config = parseInputs();

    expect(config.repository).toBe("swenyai/sweny");
    expect(config.repositoryOwner).toBe("swenyai");
  });

  it("defaults repository and repositoryOwner to empty string when env vars are unset", () => {
    mockGetInput.mockReturnValue("");
    mockGetBooleanInput.mockReturnValue(false);

    const config = parseInputs();

    expect(config.repository).toBe("");
    expect(config.repositoryOwner).toBe("");
  });

  it("reads boolean inputs from getBooleanInput", () => {
    mockGetInput.mockReturnValue("");
    mockGetBooleanInput.mockImplementation((name: string) => {
      if (name === "dry-run") return true;
      if (name === "novelty-mode") return true;
      return false;
    });

    const config = parseInputs();

    expect(config.dryRun).toBe(true);
    expect(config.noveltyMode).toBe(true);
    expect(mockGetBooleanInput).toHaveBeenCalledWith("dry-run");
    expect(mockGetBooleanInput).toHaveBeenCalledWith("novelty-mode");
  });
});
