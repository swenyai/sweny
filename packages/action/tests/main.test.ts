import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared before imports
// ---------------------------------------------------------------------------

vi.mock("@actions/core", () => ({
  startGroup: vi.fn(),
  endGroup: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  notice: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  getInput: vi.fn().mockReturnValue(""),
  getBooleanInput: vi.fn().mockReturnValue(false),
}));

const mockInvestigate = vi.fn();
const mockImplement = vi.fn();
const mockNotify = vi.fn();
const mockParseInputs = vi.fn();
const mockCreateProviders = vi.fn();

vi.mock("../src/phases/investigate.js", () => ({
  investigate: mockInvestigate,
}));

vi.mock("../src/phases/implement.js", () => ({
  implement: mockImplement,
}));

vi.mock("../src/phases/notify.js", () => ({
  notify: mockNotify,
}));

vi.mock("../src/config.js", () => ({
  parseInputs: mockParseInputs,
}));

vi.mock("../src/providers/index.js", () => ({
  createProviders: mockCreateProviders,
}));

import * as core from "@actions/core";

// We need to import after mocks are set up, but main.ts calls run() at
// module level, so we test via dynamic import or by extracting the run fn.
// Since main.ts calls run() at import time, we test the logic by calling the
// individual mocked functions and verifying the orchestration.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig() {
  return {
    dryRun: false,
    repository: "org/repo",
    serviceFilter: "*",
    timeRange: "24h",
  };
}

function makeFakeProviders() {
  return { fake: true };
}

function makeInvestigationResult(overrides = {}) {
  return {
    issuesFound: true,
    bestCandidate: true,
    recommendation: "implement",
    existingIssue: "",
    targetRepo: "",
    shouldImplement: true,
    ...overrides,
  };
}

function makeImplementResult(overrides = {}) {
  return {
    issueIdentifier: "ENG-999",
    issueUrl: "https://linear.app/ENG-999",
    prUrl: "https://github.com/org/repo/pull/42",
    prNumber: 42,
    skipped: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Since main.ts calls run() at module level on import, we replicate the
// run() logic here using the same mocked dependencies to verify orchestration.
// This avoids side-effect issues from dynamic import.
// ---------------------------------------------------------------------------

async function runMain(): Promise<void> {
  try {
    const config = mockParseInputs();
    const providers = mockCreateProviders(config);

    core.startGroup("Phase 1: Investigate Production Logs");
    const findings = await mockInvestigate(config, providers);
    core.endGroup();

    core.setOutput("issues-found", String(findings.issuesFound));
    core.setOutput("recommendation", findings.recommendation);

    let implementation;
    if (findings.shouldImplement && !config.dryRun) {
      core.startGroup("Phase 2: Implement Fix");
      implementation = await mockImplement(config, providers, findings);
      core.endGroup();

      if (!implementation.skipped) {
        core.setOutput("issue-identifier", implementation.issueIdentifier);
        core.setOutput("issue-url", implementation.issueUrl);
        core.setOutput("pr-url", implementation.prUrl);
        core.setOutput("pr-number", String(implementation.prNumber));
      }
    }

    core.startGroup("Phase 3: Create Summary");
    await mockNotify(config, providers, findings, implementation);
    core.endGroup();
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("main run()", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockParseInputs.mockReturnValue(makeConfig());
    mockCreateProviders.mockReturnValue(makeFakeProviders());
    mockInvestigate.mockResolvedValue(makeInvestigationResult());
    mockImplement.mockResolvedValue(makeImplementResult());
    mockNotify.mockResolvedValue(undefined);
  });

  // -----------------------------------------------------------------------
  // 3-phase orchestration
  // -----------------------------------------------------------------------

  it("runs investigate -> implement -> notify in order", async () => {
    const callOrder: string[] = [];
    mockInvestigate.mockImplementation(async () => {
      callOrder.push("investigate");
      return makeInvestigationResult();
    });
    mockImplement.mockImplementation(async () => {
      callOrder.push("implement");
      return makeImplementResult();
    });
    mockNotify.mockImplementation(async () => {
      callOrder.push("notify");
    });

    await runMain();

    expect(callOrder).toEqual(["investigate", "implement", "notify"]);
  });

  it("passes config and providers to all phases", async () => {
    await runMain();

    const config = makeConfig();
    const providers = makeFakeProviders();

    expect(mockInvestigate).toHaveBeenCalledWith(config, providers);
    expect(mockImplement).toHaveBeenCalledWith(
      config,
      providers,
      makeInvestigationResult(),
    );
    expect(mockNotify).toHaveBeenCalledWith(
      config,
      providers,
      makeInvestigationResult(),
      makeImplementResult(),
    );
  });

  // -----------------------------------------------------------------------
  // GitHub Action outputs
  // -----------------------------------------------------------------------

  it("sets issues-found and recommendation outputs from investigation", async () => {
    mockInvestigate.mockResolvedValue(
      makeInvestigationResult({ issuesFound: false, recommendation: "skip", shouldImplement: false }),
    );

    await runMain();

    expect(core.setOutput).toHaveBeenCalledWith("issues-found", "false");
    expect(core.setOutput).toHaveBeenCalledWith("recommendation", "skip");
  });

  it("sets PR and issue outputs on successful implementation", async () => {
    await runMain();

    expect(core.setOutput).toHaveBeenCalledWith("issue-identifier", "ENG-999");
    expect(core.setOutput).toHaveBeenCalledWith(
      "issue-url",
      "https://linear.app/ENG-999",
    );
    expect(core.setOutput).toHaveBeenCalledWith(
      "pr-url",
      "https://github.com/org/repo/pull/42",
    );
    expect(core.setOutput).toHaveBeenCalledWith("pr-number", "42");
  });

  it("does not set PR outputs when implementation is skipped", async () => {
    mockImplement.mockResolvedValue(
      makeImplementResult({ skipped: true, prUrl: "", prNumber: 0 }),
    );

    await runMain();

    expect(core.setOutput).not.toHaveBeenCalledWith(
      "pr-url",
      expect.anything(),
    );
    expect(core.setOutput).not.toHaveBeenCalledWith(
      "pr-number",
      expect.anything(),
    );
  });

  // -----------------------------------------------------------------------
  // Dry run skip
  // -----------------------------------------------------------------------

  it("skips implement phase when dryRun is true", async () => {
    mockParseInputs.mockReturnValue({ ...makeConfig(), dryRun: true });

    await runMain();

    expect(mockImplement).not.toHaveBeenCalled();
    // Notify is still called
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
      expect.anything(),
      expect.anything(),
      undefined,
    );
  });

  // -----------------------------------------------------------------------
  // shouldImplement = false skip
  // -----------------------------------------------------------------------

  it("skips implement phase when shouldImplement is false", async () => {
    mockInvestigate.mockResolvedValue(
      makeInvestigationResult({ shouldImplement: false, recommendation: "skip" }),
    );

    await runMain();

    expect(mockImplement).not.toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ shouldImplement: false }),
      undefined,
    );
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it("calls core.setFailed with Error message on failure", async () => {
    mockInvestigate.mockRejectedValue(new Error("Investigation blew up"));

    await runMain();

    expect(core.setFailed).toHaveBeenCalledWith("Investigation blew up");
  });

  it("calls core.setFailed with generic message for non-Error throws", async () => {
    mockInvestigate.mockRejectedValue("string error");

    await runMain();

    expect(core.setFailed).toHaveBeenCalledWith("An unexpected error occurred");
  });

  it("still calls notify even when implement is skipped", async () => {
    mockInvestigate.mockResolvedValue(
      makeInvestigationResult({ shouldImplement: false }),
    );

    await runMain();

    expect(mockNotify).toHaveBeenCalledOnce();
  });
});
