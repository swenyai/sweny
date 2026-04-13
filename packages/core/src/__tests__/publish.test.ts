import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { validateWorkflowFile, validateSkillDir } from "../cli/publish.js";

describe("validateWorkflowFile", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-publish-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validates a correct workflow file", () => {
    const file = path.join(tmpDir, "good.yml");
    fs.writeFileSync(
      file,
      `id: test-workflow
name: Test
description: A test workflow
entry: start
nodes:
  start:
    name: Start
    instruction: Do something.
    skills: [github]
edges: []
`,
    );

    const result = validateWorkflowFile(file);
    expect(result.valid).toBe(true);
    expect(result.id).toBe("test-workflow");
    expect(result.name).toBe("Test");
    expect(result.nodeCount).toBe(1);
    expect(result.edgeCount).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("rejects a non-existent file", () => {
    const result = validateWorkflowFile(path.join(tmpDir, "nope.yml"));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toBe("File not found");
  });

  it("rejects invalid YAML", () => {
    const file = path.join(tmpDir, "bad.yml");
    fs.writeFileSync(file, "{{invalid yaml");
    const result = validateWorkflowFile(file);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Invalid YAML/);
  });

  it("rejects a workflow missing required fields", () => {
    const file = path.join(tmpDir, "incomplete.yml");
    fs.writeFileSync(file, "id: test\nname: Test\n");
    const result = validateWorkflowFile(file);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects a workflow with unknown skill references", () => {
    const file = path.join(tmpDir, "unknown-skill.yml");
    fs.writeFileSync(
      file,
      `id: unknown-skill-test
name: Unknown Skill Test
description: Test
entry: start
nodes:
  start:
    name: Start
    instruction: Do something.
    skills: [unicorn]
edges: []
`,
    );
    const result = validateWorkflowFile(file);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unicorn"))).toBe(true);
  });

  it("returns config warnings for skills with required env vars", () => {
    const file = path.join(tmpDir, "with-github.yml");
    fs.writeFileSync(
      file,
      `id: github-test
name: GitHub Test
description: Test
entry: start
nodes:
  start:
    name: Start
    instruction: Do something.
    skills: [github]
edges: []
`,
    );
    const result = validateWorkflowFile(file);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("GITHUB_TOKEN"))).toBe(true);
  });
});

describe("validateSkillDir", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-skill-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validates a correct instruction skill", () => {
    const skillDir = path.join(tmpDir, "my-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: my-skill
description: A test skill
---

When reviewing code, check for security issues first.
`,
    );

    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(true);
    expect(result.id).toBe("my-skill");
    expect(result.hasInstruction).toBe(true);
    expect(result.hasMcp).toBe(false);
  });

  it("validates a correct MCP skill", () => {
    const skillDir = path.join(tmpDir, "mcp-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: mcp-skill
description: A test MCP skill
mcp:
  command: npx
  args: ["-y", "@company/server"]
---
`,
    );

    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(true);
    expect(result.hasMcp).toBe(true);
  });

  it("rejects a directory without SKILL.md", () => {
    const emptyDir = path.join(tmpDir, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });
    const result = validateSkillDir(emptyDir);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toBe("SKILL.md not found in directory");
  });

  it("rejects a skill with no frontmatter", () => {
    const skillDir = path.join(tmpDir, "no-fm");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "Just some text");
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toBe("No YAML frontmatter found");
  });

  it("rejects an invalid skill ID", () => {
    const skillDir = path.join(tmpDir, "Bad-Name");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: Bad-Name
---

Some instruction.
`,
    );
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Invalid skill ID/);
  });

  it("rejects a skill with mismatched directory name", () => {
    const skillDir = path.join(tmpDir, "wrong-dir");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: correct-name
---

Some instruction.
`,
    );
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`Directory name "wrong-dir" doesn't match skill name "correct-name"`);
  });

  it("rejects a skill with no instruction and no MCP", () => {
    const skillDir = path.join(tmpDir, "empty-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: empty-skill
---
`,
    );
    const result = validateSkillDir(skillDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Skill must have an instruction body or an mcp config");
  });
});
