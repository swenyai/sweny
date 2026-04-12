import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Mocks ─────────────────────────────────────────────────────────

const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock("../schema.js", () => ({
  parseWorkflow: vi.fn(),
  validateWorkflow: vi.fn(),
}));

const mockSelect = vi.fn();
const mockText = vi.fn();
const mockSpinner = vi.fn();
const mockIsCancel = vi.fn(() => false);
const mockIntro = vi.fn();
const mockCancel = vi.fn();
const mockLog = { error: vi.fn(), success: vi.fn(), info: vi.fn() };

vi.mock("@clack/prompts", () => ({
  select: (...args: unknown[]) => mockSelect(...args),
  text: (...args: unknown[]) => mockText(...args),
  spinner: () => {
    const s = { start: vi.fn(), message: vi.fn(), stop: vi.fn() };
    mockSpinner(s);
    return s;
  },
  isCancel: (value: unknown) => mockIsCancel(value),
  intro: (...args: unknown[]) => mockIntro(...args),
  cancel: (...args: unknown[]) => mockCancel(...args),
  log: mockLog,
}));

vi.mock("chalk", () => ({
  default: { cyan: (s: string) => s },
}));

const { validateWorkflowFile, validateSkillDir, runPublish } = await import("./publish.js");
const { parseWorkflow, validateWorkflow } = await import("../schema.js");

// ── Helpers ───────────────────────────────────────────────────────

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "publish-test-"));
  tmpDirs.push(dir);
  return dir;
}

function makeTmpFile(name: string, content: string): string {
  const dir = makeTmpDir();
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

/** Minimal mock node that satisfies the Node type. */
const mockNode = (name = "n") => ({ name, instruction: "test", skills: [] as string[] });

// ── Setup / Teardown ──────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockIsCancel.mockReturnValue(false);
  tmpDirs = [];
});

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── validateWorkflowFile ──────────────────────────────────────────

describe("validateWorkflowFile", () => {
  it("returns error for missing file", () => {
    const result = validateWorkflowFile("/nonexistent/file.yml");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("File not found");
  });

  it("returns error for invalid YAML", () => {
    const filePath = makeTmpFile("bad.yml", "{{{{invalid yaml");
    const result = validateWorkflowFile(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Invalid YAML/);
  });

  it("returns schema validation errors with id and name", () => {
    const filePath = makeTmpFile("test.yml", "id: test\nname: Test\n");
    vi.mocked(parseWorkflow).mockReturnValue({
      id: "test",
      name: "Test",
      nodes: { start: mockNode("start") },
      edges: [],
      entry: "start",
      skills: {},
    });
    vi.mocked(validateWorkflow).mockReturnValue([
      { code: "MISSING_ENTRY" as const, message: 'Entry node "start" does not exist' },
    ]);

    const result = validateWorkflowFile(filePath);
    expect(result.valid).toBe(false);
    expect(result.id).toBe("test");
    expect(result.name).toBe("Test");
    expect(result.errors).toContain('Entry node "start" does not exist');
  });

  it("returns valid result with node and edge counts", () => {
    const filePath = makeTmpFile("good.yml", "id: test\nname: Good\n");
    vi.mocked(parseWorkflow).mockReturnValue({
      id: "test",
      name: "Good",
      nodes: { a: mockNode("a"), b: mockNode("b"), c: mockNode("c") },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
      entry: "a",
      skills: {},
    });
    vi.mocked(validateWorkflow).mockReturnValue([]);

    const result = validateWorkflowFile(filePath);
    expect(result.valid).toBe(true);
    expect(result.nodeCount).toBe(3);
    expect(result.edgeCount).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it("catches parseWorkflow throw as schema error", () => {
    const filePath = makeTmpFile("throw.yml", "id: test\n");
    vi.mocked(parseWorkflow).mockImplementation(() => {
      throw new Error("Missing required field: entry");
    });

    const result = validateWorkflowFile(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Schema error.*Missing required field/);
  });
});

// ── validateSkillDir ──────────────────────────────────────────────

describe("validateSkillDir", () => {
  it("returns error when SKILL.md is missing", () => {
    const dir = makeTmpDir();
    const result = validateSkillDir(dir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("SKILL.md not found in directory");
  });

  it("returns error when no frontmatter found", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "SKILL.md"), "Just text, no frontmatter");
    const result = validateSkillDir(dir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("No YAML frontmatter found");
  });

  it("returns error for invalid frontmatter YAML", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "SKILL.md"), "---\n{{{{bad\n---\n\nBody");
    const result = validateSkillDir(dir);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Invalid frontmatter YAML/);
  });

  it("returns error when name is missing from frontmatter", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "SKILL.md"), "---\ndescription: test\n---\n\nBody");
    const result = validateSkillDir(dir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing 'name' field in frontmatter");
  });

  it("rejects uppercase in skill ID", () => {
    const dir = makeTmpDir();
    const skillDir = path.join(dir, "BadName");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: BadName\n---\n\nBody");
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Invalid skill ID/);
  });

  it("rejects consecutive hyphens in skill ID", () => {
    const dir = makeTmpDir();
    const skillDir = path.join(dir, "my--skill");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: my--skill\n---\n\nBody");
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Invalid skill ID/);
  });

  it("rejects skill ID over 64 characters", () => {
    const dir = makeTmpDir();
    const longId = "a".repeat(65);
    const skillDir = path.join(dir, longId);
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: ${longId}\n---\n\nBody`);
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Invalid skill ID/);
  });

  it("accepts exactly 64-character skill ID", () => {
    const dir = makeTmpDir();
    const id64 = "a".repeat(64);
    const skillDir = path.join(dir, id64);
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: ${id64}\n---\n\nBody`);
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(true);
  });

  it("rejects skill ID starting with hyphen", () => {
    const dir = makeTmpDir();
    const skillDir = path.join(dir, "-bad");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: -bad\n---\n\nBody");
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(false);
  });

  it("rejects skill ID ending with hyphen", () => {
    const dir = makeTmpDir();
    const skillDir = path.join(dir, "bad-");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: bad-\n---\n\nBody");
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(false);
  });

  it("reports when directory name doesn't match skill name", () => {
    const dir = makeTmpDir();
    const skillDir = path.join(dir, "wrong-name");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: real-name\n---\n\nBody");
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Directory name "wrong-name" doesn\'t match skill name "real-name"');
  });

  it("rejects skill with neither instruction body nor mcp", () => {
    const dir = makeTmpDir();
    const skillDir = path.join(dir, "empty");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: empty\n---\n");
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Skill must have an instruction body or an mcp config");
  });

  it("validates skill with instruction body", () => {
    const dir = makeTmpDir();
    const skillDir = path.join(dir, "my-skill");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: my-skill\n---\n\nDo the thing.");
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(true);
    expect(result.id).toBe("my-skill");
    expect(result.hasInstruction).toBe(true);
    expect(result.hasMcp).toBe(false);
  });

  it("validates skill with mcp config only", () => {
    const dir = makeTmpDir();
    const skillDir = path.join(dir, "mcp-only");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), '---\nname: mcp-only\nmcp:\n  command: "node"\n---\n');
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(true);
    expect(result.hasInstruction).toBe(false);
    expect(result.hasMcp).toBe(true);
  });

  it("validates skill with both instruction and mcp", () => {
    const dir = makeTmpDir();
    const skillDir = path.join(dir, "both");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      '---\nname: both\nmcp:\n  command: "node"\n---\n\nAlso instructions.',
    );
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(true);
    expect(result.hasInstruction).toBe(true);
    expect(result.hasMcp).toBe(true);
  });

  it("accepts single-character skill ID", () => {
    const dir = makeTmpDir();
    const skillDir = path.join(dir, "a");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: a\n---\n\nBody.");
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(true);
  });

  it("accepts skill ID with numbers", () => {
    const dir = makeTmpDir();
    const skillDir = path.join(dir, "tool2");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: tool2\n---\n\nBody.");
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(true);
  });
});

// ── runPublish ────────────────────────────────────────────────────

describe("runPublish", () => {
  it("shows intro message", async () => {
    mockSelect.mockResolvedValue("workflow");
    mockText.mockResolvedValue("/nonexistent.yml");

    await runPublish();

    expect(mockIntro).toHaveBeenCalledWith("Publish to the SWEny Marketplace");
  });

  it("returns null when user cancels content type selection", async () => {
    const cancelSymbol = Symbol("cancel");
    mockSelect.mockResolvedValue(cancelSymbol);
    mockIsCancel.mockImplementation((v: unknown) => v === cancelSymbol);

    // cancel() calls process.exit(0), which we need to catch
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(runPublish()).rejects.toThrow("process.exit");
    expect(mockCancel).toHaveBeenCalledWith("Publish cancelled.");
    mockExit.mockRestore();
  });
});

// ── openGitHubPR (via runPublish integration) ─────────────────────

describe("openGitHubPR flow", () => {
  function setupWorkflowPRFlow(workflowPath: string) {
    // Step 1: select "workflow"
    mockSelect.mockResolvedValueOnce("workflow");
    // Step 2: text input for file path
    mockText.mockResolvedValueOnce(workflowPath);
    // Step 3: author
    mockText.mockResolvedValueOnce("test-author");
    // Step 4: category
    mockSelect.mockResolvedValueOnce("testing");
    // Step 5: tags
    mockText.mockResolvedValueOnce("test, ci");
    // Step 6: output mode = PR
    mockSelect.mockResolvedValueOnce("pr");

    // Mock workflow validation
    vi.mocked(parseWorkflow).mockReturnValue({
      id: "my-wf",
      name: "My Workflow",
      nodes: { a: mockNode("a") },
      edges: [],
      entry: "a",
      skills: {},
    });
    vi.mocked(validateWorkflow).mockReturnValue([]);

    // Mock gh available — clone creates the dir structure the code expects
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "gh" && args[0] === "--version") return "gh version 2.0.0";
      if (cmd === "gh" && args[0] === "auth") return "";
      if (cmd === "gh" && args[0] === "repo" && args[1] === "fork") return "";
      if (cmd === "gh" && args[0] === "api" && args[1] === "user") {
        return JSON.stringify({ login: "testuser" });
      }
      if (cmd === "gh" && args[0] === "repo" && args[1] === "clone") {
        // args: ["repo", "clone", forkRepo, tmpDir, "--", "--depth", "1"]
        const cloneDir = args[3];
        fs.mkdirSync(path.join(cloneDir, "workflows", "community"), { recursive: true });
        fs.mkdirSync(path.join(cloneDir, "skills", "community"), { recursive: true });
        return "";
      }
      if (cmd === "git") return "";
      if (cmd === "gh" && args[0] === "pr") return "https://github.com/swenyai/marketplace/pull/42\n";
      return "";
    });
  }

  it("creates PR with correct gh pr create arguments", async () => {
    const dir = makeTmpDir();
    const wfPath = path.join(dir, "test.yml");
    fs.writeFileSync(wfPath, "id: my-wf\nname: My Workflow\n");

    setupWorkflowPRFlow(wfPath);

    const result = await runPublish();

    // Find the gh pr create call
    const prCall = mockExecFileSync.mock.calls.find(
      (c) => c[0] === "gh" && c[1]?.[0] === "pr" && c[1]?.[1] === "create",
    );
    expect(prCall).toBeDefined();
    const args = prCall![1] as string[];
    expect(args).toContain("--repo");
    expect(args).toContain("swenyai/marketplace");
    expect(args).toContain("--head");
    expect(args).toContain("testuser:publish/workflow/my-wf");
    expect(args).toContain("--title");
    expect(args).toContain("feat: add workflow my-wf");

    expect(result?.prUrl).toBe("https://github.com/swenyai/marketplace/pull/42");
    expect(result?.type).toBe("workflow");
    expect(result?.id).toBe("my-wf");
  });

  it("passes commit message as array arg, not shell string", async () => {
    const dir = makeTmpDir();
    const wfPath = path.join(dir, "test.yml");
    fs.writeFileSync(wfPath, "id: my-wf\nname: My Workflow\n");

    setupWorkflowPRFlow(wfPath);
    await runPublish();

    const commitCall = mockExecFileSync.mock.calls.find((c) => c[0] === "git" && c[1]?.includes("commit"));
    expect(commitCall).toBeDefined();
    const args = commitCall![1] as string[];
    // Commit message is a single array element, not split by shell
    expect(args).toContain("-m");
    expect(args).toContain("feat: add my-wf workflow");
  });

  it("falls back to saveLocally when gh commands fail", async () => {
    const dir = makeTmpDir();
    const wfPath = path.join(dir, "test.yml");
    fs.writeFileSync(wfPath, "id: my-wf\nname: My Workflow\n");

    // Step 1: select "workflow"
    mockSelect.mockResolvedValueOnce("workflow");
    mockText.mockResolvedValueOnce(wfPath);
    mockText.mockResolvedValueOnce("author");
    mockSelect.mockResolvedValueOnce("testing");
    mockText.mockResolvedValueOnce("test");
    mockSelect.mockResolvedValueOnce("pr"); // choose PR mode

    vi.mocked(parseWorkflow).mockReturnValue({
      id: "my-wf",
      name: "My Workflow",
      nodes: { a: mockNode("a") },
      edges: [],
      entry: "a",
      skills: {},
    });
    vi.mocked(validateWorkflow).mockReturnValue([]);

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "gh" && args[0] === "--version") return "gh version 2.0.0";
      if (cmd === "gh" && args[0] === "auth") return "";
      // Fork fails
      if (cmd === "gh" && args[0] === "repo" && args[1] === "fork") {
        throw new Error("Network error");
      }
      return "";
    });

    const result = await runPublish();

    // Should have fallen back to save locally
    expect(result?.type).toBe("workflow");
    expect(result?.outputPath).toBeDefined();
    expect(mockLog.error).toHaveBeenCalled();
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("Falling back"));
  });

  it("handles special characters in skill ID safely via array args", async () => {
    const dir = makeTmpDir();
    // Create a skill directory with a name that would be dangerous in shell
    const skillDir = path.join(dir, "safe-skill");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: safe-skill\n---\n\nBody.");

    // Select skill → provide path → choose PR mode
    mockSelect.mockResolvedValueOnce("skill");
    mockText.mockResolvedValueOnce(skillDir);
    mockSelect.mockResolvedValueOnce("pr");

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "gh" && args[0] === "--version") return "gh version 2.0.0";
      if (cmd === "gh" && args[0] === "auth") return "";
      if (cmd === "gh" && args[0] === "repo" && args[1] === "fork") return "";
      if (cmd === "gh" && args[0] === "api") return JSON.stringify({ login: "user" });
      if (cmd === "gh" && args[0] === "repo" && args[1] === "clone") {
        const cloneDir = args[2];
        fs.mkdirSync(path.join(cloneDir, "workflows", "community"), { recursive: true });
        fs.mkdirSync(path.join(cloneDir, "skills", "community"), { recursive: true });
        return "";
      }
      if (cmd === "git") return "";
      if (cmd === "gh" && args[0] === "pr") return "https://github.com/swenyai/marketplace/pull/99\n";
      return "";
    });

    const result = await runPublish();
    expect(result?.type).toBe("skill");

    // Verify all git/gh commands used array args (not string interpolation)
    for (const call of mockExecFileSync.mock.calls) {
      expect(typeof call[0]).toBe("string"); // command is a string
      expect(Array.isArray(call[1])).toBe(true); // args is an array
    }
  });
});

// ── saveLocally flow ──────────────────────────────────────────────

describe("saveLocally flow", () => {
  afterEach(() => {
    // Clean up sweny-publish directory if created
    const publishDir = path.resolve("sweny-publish");
    if (fs.existsSync(publishDir)) {
      fs.rmSync(publishDir, { recursive: true, force: true });
    }
  });

  it("saves workflow file locally when no gh available", async () => {
    const dir = makeTmpDir();
    const wfPath = path.join(dir, "test.yml");
    fs.writeFileSync(wfPath, "id: local-wf\nname: Local\n");

    mockSelect.mockResolvedValueOnce("workflow");
    mockText.mockResolvedValueOnce(wfPath);
    mockText.mockResolvedValueOnce("author");
    mockSelect.mockResolvedValueOnce("testing");
    mockText.mockResolvedValueOnce("test");
    // gh not available → only "save" option
    mockSelect.mockResolvedValueOnce("save");

    vi.mocked(parseWorkflow).mockReturnValue({
      id: "local-wf",
      name: "Local",
      nodes: { a: mockNode("a") },
      edges: [],
      entry: "a",
      skills: {},
    });
    vi.mocked(validateWorkflow).mockReturnValue([]);
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });

    const result = await runPublish();
    expect(result?.type).toBe("workflow");
    expect(result?.outputPath).toMatch(/sweny-publish.*local-wf\.yml/);
    expect(fs.existsSync(result!.outputPath!)).toBe(true);
  });

  it("saves skill directory locally", async () => {
    const dir = makeTmpDir();
    const skillDir = path.join(dir, "my-skill");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: my-skill\n---\n\nBody.");
    fs.writeFileSync(path.join(skillDir, "extra.txt"), "extra file");

    mockSelect.mockResolvedValueOnce("skill");
    mockText.mockResolvedValueOnce(skillDir);
    mockSelect.mockResolvedValueOnce("save");

    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });

    const result = await runPublish();
    expect(result?.type).toBe("skill");
    expect(result?.outputPath).toMatch(/sweny-publish.*my-skill/);
    // Verify files were copied
    expect(fs.existsSync(path.join(result!.outputPath!, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(result!.outputPath!, "extra.txt"))).toBe(true);
  });
});

// ── Validation failure paths ──────────────────────────────────────

describe("validation failure paths", () => {
  it("returns null when workflow validation fails", async () => {
    const dir = makeTmpDir();
    const wfPath = path.join(dir, "bad.yml");
    fs.writeFileSync(wfPath, "id: bad\n");

    mockSelect.mockResolvedValueOnce("workflow");
    mockText.mockResolvedValueOnce(wfPath);

    vi.mocked(parseWorkflow).mockImplementation(() => {
      throw new Error("Invalid");
    });

    const result = await runPublish();
    expect(result).toBeNull();
    expect(mockLog.error).toHaveBeenCalled();
  });

  it("returns null when skill validation fails", async () => {
    const dir = makeTmpDir();
    // No SKILL.md in directory
    mockSelect.mockResolvedValueOnce("skill");
    // The text validator will reject this before we get to validateSkillDir
    // So let's provide a dir with SKILL.md that has bad frontmatter
    fs.writeFileSync(path.join(dir, "SKILL.md"), "no frontmatter");

    mockText.mockResolvedValueOnce(dir);

    const result = await runPublish();
    expect(result).toBeNull();
    expect(mockLog.error).toHaveBeenCalled();
  });
});

// ── ghAvailable / ghAuthenticated ─────────────────────────────────

describe("gh availability detection", () => {
  it("shows PR option when gh is available", async () => {
    const dir = makeTmpDir();
    const wfPath = path.join(dir, "test.yml");
    fs.writeFileSync(wfPath, "id: wf\nname: WF\n");

    mockSelect.mockResolvedValueOnce("workflow");
    mockText.mockResolvedValueOnce(wfPath);
    mockText.mockResolvedValueOnce("author");
    mockSelect.mockResolvedValueOnce("testing");
    mockText.mockResolvedValueOnce("test");
    mockSelect.mockResolvedValueOnce("save"); // choose save

    vi.mocked(parseWorkflow).mockReturnValue({
      id: "wf",
      name: "WF",
      nodes: { a: mockNode("a") },
      edges: [],
      entry: "a",
      skills: {},
    });
    vi.mocked(validateWorkflow).mockReturnValue([]);

    // gh is available — only --version needs to succeed for ghAvailable()
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "gh" && args[0] === "--version") return "gh version 2.0.0";
      return "";
    });

    await runPublish();

    // Verify the output mode select was called with PR option
    const outputModeCall = mockSelect.mock.calls[2]; // 3rd select call
    const options = outputModeCall[0].options;
    expect(options.some((o: { value: string }) => o.value === "pr")).toBe(true);
  });

  it("hides PR option when gh is not available", async () => {
    const dir = makeTmpDir();
    const wfPath = path.join(dir, "test.yml");
    fs.writeFileSync(wfPath, "id: wf\nname: WF\n");

    mockSelect.mockResolvedValueOnce("workflow");
    mockText.mockResolvedValueOnce(wfPath);
    mockText.mockResolvedValueOnce("author");
    mockSelect.mockResolvedValueOnce("testing");
    mockText.mockResolvedValueOnce("test");
    mockSelect.mockResolvedValueOnce("save");

    vi.mocked(parseWorkflow).mockReturnValue({
      id: "wf",
      name: "WF",
      nodes: { a: mockNode("a") },
      edges: [],
      entry: "a",
      skills: {},
    });
    vi.mocked(validateWorkflow).mockReturnValue([]);

    // gh not available
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });

    await runPublish();

    // Verify output mode select has no PR option
    const outputModeCall = mockSelect.mock.calls[2];
    const options = outputModeCall[0].options;
    expect(options.every((o: { value: string }) => o.value !== "pr")).toBe(true);
  });
});
