/**
 * Tests for `sweny workflow run` and `sweny workflow export` commands.
 *
 * Imports `workflowRunAction`, `workflowExportAction`, and `loadWorkflowFile`
 * as exported functions from main.ts, with all dependencies mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Persistent mock references
const mockRunWorkflow = vi.fn();
const mockResolveWorkflow = vi.fn();
const mockValidateWorkflow = vi.fn();
const mockListStepTypes = vi.fn();
const mockParseYaml = vi.fn();
const mockStringifyYaml = vi.fn();
const mockReadFileSync = vi.fn();
const mockCreateProviders = vi.fn();

async function loadModule() {
  vi.doMock("node:fs", () => ({
    existsSync: vi.fn().mockReturnValue(false),
    writeFileSync: vi.fn(),
    readFileSync: mockReadFileSync,
    mkdirSync: vi.fn(),
  }));
  vi.doMock("node:path", () => ({
    join: (...args: string[]) => args.join("/"),
    extname: (p: string) => {
      const dot = p.lastIndexOf(".");
      return dot >= 0 ? p.slice(dot) : "";
    },
    resolve: (...args: string[]) => args[args.length - 1],
  }));
  vi.doMock("chalk", () => ({
    default: Object.assign((s: string) => s, {
      red: (s: string) => s,
      green: (s: string) => s,
      yellow: (s: string) => s,
      dim: (s: string) => s,
      cyan: (s: string) => s,
      bold: (s: string) => s,
    }),
    red: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    dim: (s: string) => s,
    cyan: (s: string) => s,
    bold: (s: string) => s,
  }));
  vi.doMock("yaml", () => ({
    parse: mockParseYaml,
    stringify: mockStringifyYaml,
  }));
  vi.doMock("../src/config-file.js", () => ({
    loadDotenv: vi.fn(),
    loadConfigFile: vi.fn().mockReturnValue({}),
    STARTER_CONFIG: "",
  }));
  vi.doMock("../src/config.js", () => ({
    registerTriageCommand: vi.fn().mockReturnValue({ action: vi.fn().mockReturnValue({}) }),
    registerImplementCommand: vi.fn().mockReturnValue({ action: vi.fn().mockReturnValue({}) }),
    parseCliInputs: vi.fn().mockReturnValue({
      json: false,
      dryRun: false,
      bell: false,
      noCache: true,
      cacheDir: "",
      cacheTtl: 0,
      timeRange: "24h",
      severityFocus: "errors",
      serviceFilter: "*",
      investigationDepth: "standard",
      maxInvestigateTurns: 50,
      maxImplementTurns: 30,
      serviceMapPath: "",
      repository: "",
      baseBranch: "main",
      prLabels: [],
      reviewMode: "review",
      noveltyMode: false,
      issueOverride: "",
      additionalInstructions: "",
      observabilityProvider: "datadog",
      observabilityCredentials: {},
      issueTrackerProvider: "linear",
      sourceControlProvider: "github",
      codingAgentProvider: "claude",
      notificationProvider: "console",
      botToken: "",
      githubToken: "",
      gitlabToken: "",
      gitlabProjectId: "",
      gitlabBaseUrl: "",
      linearApiKey: "",
      linearTeamId: "",
      linearBugLabelId: "",
      linearTriageLabelId: "",
      linearStateBacklog: "",
      linearStateInProgress: "",
      linearStatePeerReview: "",
      notificationWebhookUrl: "",
      sendgridApiKey: "",
      emailFrom: "",
      emailTo: "",
      webhookSigningSecret: "",
      anthropicApiKey: "",
      claudeOauthToken: "",
      openaiApiKey: "",
      geminiApiKey: "",
      jiraBaseUrl: "",
      jiraEmail: "",
      jiraApiToken: "",
      issueLabels: [],
      mcpServers: {},
      workspaceTools: [],
    }),
    validateInputs: vi.fn().mockReturnValue([]),
  }));
  vi.doMock("@sweny-ai/engine", () => ({
    runWorkflow: mockRunWorkflow,
    triageWorkflow: { name: "triage", definition: { steps: {} } },
    implementWorkflow: { name: "implement", definition: { steps: {} } },
    triageDefinition: {
      id: "triage",
      name: "Triage",
      version: "1.0.0",
      initial: "verify-access",
      steps: { "verify-access": { phase: "learn" } },
    },
    implementDefinition: { id: "implement", name: "Implement", version: "1.0.0", initial: "verify-access", steps: {} },
    createProviderRegistry: vi.fn(() => ({ set: vi.fn(), get: vi.fn(), has: vi.fn() })),
    validateWorkflow: mockValidateWorkflow,
    resolveWorkflow: mockResolveWorkflow,
    listStepTypes: mockListStepTypes,
    WORKFLOW_YAML_SCHEMA_HEADER:
      "# yaml-language-server: $schema=https://sweny.ai/schemas/workflow-definition.schema.json\n",
  }));
  vi.doMock("@sweny-ai/engine/builtin-steps", () => ({}));
  vi.doMock("../src/providers/index.js", () => ({
    createProviders: mockCreateProviders,
    createImplementProviders: vi.fn().mockReturnValue({ set: vi.fn(), get: vi.fn(), has: vi.fn() }),
  }));
  vi.doMock("../src/cache.js", () => ({
    createFsCache: vi.fn().mockReturnValue({ get: vi.fn(), set: vi.fn() }),
    hashConfig: vi.fn().mockReturnValue("hash"),
  }));
  vi.doMock("../src/output.js", () => ({
    c: { subtle: (s: string) => s, ok: (s: string) => s, fail: (s: string) => s },
    phaseColor: vi.fn().mockReturnValue((s: string) => s),
    formatBanner: vi.fn().mockReturnValue(""),
    formatPhaseHeader: vi.fn().mockReturnValue(""),
    formatStepLine: vi.fn().mockReturnValue(""),
    getStepDetails: vi.fn().mockReturnValue([]),
    formatResultHuman: vi.fn().mockReturnValue(""),
    formatResultJson: vi.fn().mockReturnValue("{}"),
    formatValidationErrors: vi.fn().mockReturnValue(""),
    formatCrashError: vi.fn().mockReturnValue(""),
  }));

  process.argv = ["node", "sweny"];
  return await import("../src/main.js");
}

describe("loadWorkflowFile", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("parses YAML file correctly", async () => {
    const { loadWorkflowFile } = await loadModule();
    const def = { id: "t", version: "1.0.0", name: "test", initial: "a", steps: { a: { phase: "learn" } } };
    mockReadFileSync.mockReturnValue("some yaml");
    mockParseYaml.mockReturnValue(def);
    mockValidateWorkflow.mockReturnValue([]);

    const result = loadWorkflowFile("test.yaml");
    expect(result).toEqual(def);
    expect(mockParseYaml).toHaveBeenCalledWith("some yaml");
  });

  it("parses JSON file without calling parseYaml", async () => {
    const { loadWorkflowFile } = await loadModule();
    const def = { id: "t", version: "1.0.0", name: "test", initial: "a", steps: {} };
    mockReadFileSync.mockReturnValue(JSON.stringify(def));
    mockValidateWorkflow.mockReturnValue([]);

    const result = loadWorkflowFile("test.json");
    expect(result).toEqual(def);
    expect(mockParseYaml).not.toHaveBeenCalled();
  });

  it("throws when validateWorkflow returns errors", async () => {
    const { loadWorkflowFile } = await loadModule();
    mockReadFileSync.mockReturnValue("{}");
    mockParseYaml.mockReturnValue({});
    mockValidateWorkflow.mockReturnValue([{ message: "missing initial", code: "MISSING_INITIAL" }]);

    expect(() => loadWorkflowFile("bad.yaml")).toThrow("Invalid workflow file");
  });

  it("throws when readFileSync throws", async () => {
    const { loadWorkflowFile } = await loadModule();
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(() => loadWorkflowFile("missing.yaml")).toThrow("ENOENT");
  });
});

describe("workflowRunAction", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("exits 1 when file cannot be read", async () => {
    const { workflowRunAction } = await loadModule();
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });

    await workflowRunAction("missing.yaml", {});
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 0 and prints step list on --dry-run", async () => {
    const { workflowRunAction } = await loadModule();
    const def = { id: "t", version: "1.0.0", name: "My Workflow", initial: "a", steps: { a: { phase: "learn" } } };
    mockReadFileSync.mockReturnValue("yaml");
    mockParseYaml.mockReturnValue(def);
    mockValidateWorkflow.mockReturnValue([]);

    await workflowRunAction("ok.yaml", { dryRun: true });
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("My Workflow"));
  });

  it("exits 1 when resolveWorkflow throws unknown step type", async () => {
    const { workflowRunAction } = await loadModule();
    const def = {
      id: "t",
      version: "1.0.0",
      name: "test",
      initial: "a",
      steps: { a: { phase: "learn", type: "sweny/unknown" } },
    };
    mockReadFileSync.mockReturnValue("yaml");
    mockParseYaml.mockReturnValue(def);
    mockValidateWorkflow.mockReturnValue([]);
    mockResolveWorkflow.mockImplementation(() => {
      throw new Error('Unknown step type "sweny/unknown"');
    });

    await workflowRunAction("bad.yaml", {});
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown step type"));
  });

  it("runs workflow and exits 0 on success", async () => {
    const { workflowRunAction } = await loadModule();
    const def = {
      id: "t",
      version: "1.0.0",
      name: "test",
      initial: "a",
      steps: { a: { phase: "learn", type: "sweny/verify-access" } },
    };
    mockReadFileSync.mockReturnValue("yaml");
    mockParseYaml.mockReturnValue(def);
    mockValidateWorkflow.mockReturnValue([]);
    mockResolveWorkflow.mockReturnValue({ definition: { steps: {} }, implementations: {} });
    mockCreateProviders.mockReturnValue({ set: vi.fn(), get: vi.fn(), has: vi.fn() });
    mockRunWorkflow.mockResolvedValue({ status: "completed", steps: [] });

    await workflowRunAction("ok.yaml", {});
    expect(mockRunWorkflow).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits 1 when workflow returns failed status", async () => {
    const { workflowRunAction } = await loadModule();
    const def = { id: "t", version: "1.0.0", name: "test", initial: "a", steps: {} };
    mockReadFileSync.mockReturnValue("yaml");
    mockParseYaml.mockReturnValue(def);
    mockValidateWorkflow.mockReturnValue([]);
    mockResolveWorkflow.mockReturnValue({ definition: { steps: {} }, implementations: {} });
    mockCreateProviders.mockReturnValue({ set: vi.fn(), get: vi.fn(), has: vi.fn() });
    mockRunWorkflow.mockResolvedValue({ status: "failed", steps: [] });

    await workflowRunAction("fail.yaml", {});
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("workflowExportAction", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("writes triage YAML to stdout with schema comment header", async () => {
    const { workflowExportAction } = await loadModule();
    mockStringifyYaml.mockReturnValue("id: triage\n");

    workflowExportAction("triage");

    expect(mockStringifyYaml).toHaveBeenCalled();
    const written = stdoutSpy.mock.calls[0][0] as string;
    expect(written).toContain("yaml-language-server: $schema=");
    expect(written).toContain("id: triage");
  });

  it("writes implement YAML to stdout with schema comment header", async () => {
    const { workflowExportAction } = await loadModule();
    mockStringifyYaml.mockReturnValue("id: implement\n");

    workflowExportAction("implement");

    const written = stdoutSpy.mock.calls[0][0] as string;
    expect(written).toContain("yaml-language-server: $schema=");
    expect(written).toContain("id: implement");
  });

  it("exits 1 for unknown workflow name", async () => {
    const { workflowExportAction } = await loadModule();

    workflowExportAction("unknown");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown workflow"));
  });
});

describe("workflowListAction", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  const sampleTypes = [
    { type: "sweny/verify-access", description: "Verify credentials" },
    { type: "sweny/investigate", description: "Run agent investigation" },
  ];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockListStepTypes.mockReturnValue(sampleTypes);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("prints human-readable list with type and description", async () => {
    const { workflowListAction } = await loadModule();
    workflowListAction({});

    const allOutput = consoleLogSpy.mock.calls.flat().join("\n");
    expect(allOutput).toContain("sweny/verify-access");
    expect(allOutput).toContain("Verify credentials");
    expect(allOutput).toContain("sweny/investigate");
  });

  it("--json outputs valid JSON array with type and description fields", async () => {
    const { workflowListAction } = await loadModule();
    workflowListAction({ json: true });

    const written = (stdoutSpy.mock.calls[0][0] as string).trim();
    const parsed = JSON.parse(written);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty("type", "sweny/verify-access");
    expect(parsed[0]).toHaveProperty("description", "Verify credentials");
    expect(parsed[1]).toHaveProperty("type", "sweny/investigate");
  });

  it("--json does not call console.log", async () => {
    const { workflowListAction } = await loadModule();
    workflowListAction({ json: true });

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});

describe("workflowRunAction --steps flag", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("exits 1 and prints error when --steps path does not exist", async () => {
    const { workflowRunAction } = await loadModule();

    await workflowRunAction("ok.yaml", { steps: "/tmp/definitely-nonexistent-steps-xyz123abc.js" });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to load steps module"));
  });

  // Happy-path integration (--steps module loads and workflow runs) is exercised by
  // e2e tests; the unit test boundary stops at the error-path above because dynamic
  // import() interacts poorly with Vitest's module-mock registry.
});

describe("workflowValidateAction", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("exits 0 and prints ✓ for a valid YAML file", async () => {
    const { workflowValidateAction } = await loadModule();
    const def = { id: "t", version: "1.0.0", name: "test", initial: "a", steps: { a: { phase: "learn" } } };
    mockReadFileSync.mockReturnValue("yaml");
    mockParseYaml.mockReturnValue(def);
    mockValidateWorkflow.mockReturnValue([]);

    workflowValidateAction("ok.yaml", {});

    expect(mockParseYaml).toHaveBeenCalledWith("yaml");
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("✓"));
  });

  it("exits 1 and prints errors for an invalid workflow", async () => {
    const { workflowValidateAction } = await loadModule();
    mockReadFileSync.mockReturnValue("yaml");
    mockParseYaml.mockReturnValue({});
    mockValidateWorkflow.mockReturnValue([{ message: 'initial step "start" does not exist', code: "MISSING_INITIAL" }]);

    workflowValidateAction("bad.yaml", {});

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("✗"));
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("initial step"));
  });

  it("exits 1 when file cannot be read", async () => {
    const { workflowValidateAction } = await loadModule();
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });

    workflowValidateAction("missing.yaml", {});

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Cannot read"));
  });

  it("--json outputs { valid: true, errors: [] } for a valid file", async () => {
    const { workflowValidateAction } = await loadModule();
    const def = { id: "t", version: "1.0.0", name: "test", initial: "a", steps: { a: { phase: "learn" } } };
    mockReadFileSync.mockReturnValue("yaml");
    mockParseYaml.mockReturnValue(def);
    mockValidateWorkflow.mockReturnValue([]);

    workflowValidateAction("ok.yaml", { json: true });

    const written = (stdoutSpy.mock.calls[0][0] as string).trim();
    const parsed = JSON.parse(written);
    expect(parsed.valid).toBe(true);
    expect(parsed.errors).toEqual([]);
  });

  it("--json outputs { valid: false, errors: [...] } for an invalid file", async () => {
    const { workflowValidateAction } = await loadModule();
    mockReadFileSync.mockReturnValue("yaml");
    mockParseYaml.mockReturnValue({});
    mockValidateWorkflow.mockReturnValue([{ message: "missing initial", code: "MISSING_INITIAL" }]);

    workflowValidateAction("bad.yaml", { json: true });

    const written = (stdoutSpy.mock.calls[0][0] as string).trim();
    const parsed = JSON.parse(written);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toHaveProperty("message", "missing initial");
  });

  it("--json writes error object to stderr when file cannot be read", async () => {
    const { workflowValidateAction } = await loadModule();
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    workflowValidateAction("missing.yaml", { json: true });

    // stdout must be empty — errors go to stderr in --json mode
    expect(stdoutSpy).not.toHaveBeenCalled();
    // Find the JSON call among stderr writes (Commander may also write to stderr)
    const jsonCall = stderrSpy.mock.calls.find((args) => (args[0] as string).trim().startsWith("{"));
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse((jsonCall![0] as string).trim());
    expect(parsed.valid).toBe(false);
    expect(parsed.errors[0]).toHaveProperty("message", "ENOENT");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
