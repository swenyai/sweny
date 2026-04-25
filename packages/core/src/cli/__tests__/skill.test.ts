import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parse as parseYaml } from "yaml";

import { renderSkillTemplate, runSkillNew, runSkillList } from "../skill.js";
import { discoverSkillsWithDiagnostics } from "../../skills/custom-loader.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("renderSkillTemplate", () => {
  it("emits valid YAML frontmatter parseable by the discovery loader", () => {
    const md = renderSkillTemplate({
      id: "voyage-embeddings",
      description: "Embed text via Voyage AI",
      category: "data",
    });

    const fmMatch = md.match(/^---\s*\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();
    const fm = parseYaml(fmMatch![1]) as Record<string, unknown>;
    expect(fm.name).toBe("voyage-embeddings");
    expect(fm.description).toBe("Embed text via Voyage AI");
    expect(fm.category).toBe("data");
  });

  it("includes a body the LLM can actually consume as instruction", () => {
    const md = renderSkillTemplate({
      id: "my-skill",
      description: "Do a thing",
      category: "general",
    });
    const body = md.split(/\n---\n/)[1] ?? "";
    expect(body).toContain("# my-skill");
    expect(body).toContain("Do a thing");
    expect(body).toContain("skills: [my-skill]");
  });

  it("commented-out config and mcp blocks are syntactically valid YAML when uncommented", () => {
    const md = renderSkillTemplate({ id: "x", description: "x", category: "general" });
    // Strip leading "# " from any commented frontmatter lines and re-parse.
    const fmMatch = md.match(/^---\s*\n([\s\S]*?)\n---/)!;
    const uncommented = fmMatch[1]
      .split("\n")
      .map((line) => (line.startsWith("# ") ? line.slice(2) : line.replace(/^#$/, "")))
      .join("\n");
    expect(() => parseYaml(uncommented)).not.toThrow();
  });
});

describe("scaffolded skill is round-trippable through discovery", () => {
  it("a SKILL.md created from the template is discovered with the right id", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-skill-test-"));
    try {
      const skillDir = path.join(tmp, ".claude", "skills", "voyage-embeddings");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        renderSkillTemplate({
          id: "voyage-embeddings",
          description: "Embed text via Voyage AI",
          category: "data",
        }),
        "utf-8",
      );

      const result = discoverSkillsWithDiagnostics(tmp);
      expect(result.warnings).toEqual([]);
      const ids = result.skills.map((s) => s.id);
      expect(ids).toContain("voyage-embeddings");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("custom skill 'category' frontmatter is honored by the discovery loader", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-skill-cat-"));
    try {
      const skillDir = path.join(tmp, ".claude", "skills", "voyage-embeddings");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        renderSkillTemplate({ id: "voyage-embeddings", description: "x", category: "data" }),
        "utf-8",
      );
      const skill = discoverSkillsWithDiagnostics(tmp).skills.find((s) => s.id === "voyage-embeddings");
      expect(skill?.category).toBe("data");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("invalid 'category' frontmatter falls back to 'general' rather than throwing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-skill-cat-fallback-"));
    try {
      const skillDir = path.join(tmp, ".claude", "skills", "weird");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "---\nname: weird\ndescription: bad category\ncategory: not-a-real-category\n---\nbody",
        "utf-8",
      );
      const result = discoverSkillsWithDiagnostics(tmp);
      const skill = result.skills.find((s) => s.id === "weird");
      expect(skill?.category).toBe("general");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("runSkillNew", () => {
  let tmp: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-skill-new-"));
    // process.exit must throw so a failing assertion in the runner doesn't
    // actually terminate the test process.
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("writes .claude/skills/<id>/SKILL.md by default and prints next steps", () => {
    runSkillNew("voyage-embeddings", { description: "Embed text via Voyage", category: "data" }, tmp);

    const skillFile = path.join(tmp, ".claude", "skills", "voyage-embeddings", "SKILL.md");
    expect(fs.existsSync(skillFile)).toBe(true);
    expect(fs.readFileSync(skillFile, "utf-8")).toContain("name: voyage-embeddings");
    const stdout = logSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(stdout).toContain("Next steps");
    expect(stdout).toContain("skills: [voyage-embeddings]");
  });

  it("respects --harness sweny and writes to .sweny/skills/<id>/", () => {
    runSkillNew("foo", { description: "x", category: "general", harness: "sweny" }, tmp);
    expect(fs.existsSync(path.join(tmp, ".sweny", "skills", "foo", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, ".claude", "skills", "foo", "SKILL.md"))).toBe(false);
  });

  it("respects --harness agents and gemini variants", () => {
    runSkillNew("a", { description: "x", category: "general", harness: "agents" }, tmp);
    runSkillNew("g", { description: "x", category: "general", harness: "gemini" }, tmp);
    expect(fs.existsSync(path.join(tmp, ".agents", "skills", "a", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, ".gemini", "skills", "g", "SKILL.md"))).toBe(true);
  });

  it("rejects an invalid skill id with exit code 2 and writes nothing", () => {
    expect(() => runSkillNew("Bad_ID!", { description: "x", category: "general" }, tmp)).toThrow("process.exit(2)");
    expect(fs.existsSync(path.join(tmp, ".claude"))).toBe(false);
    expect(errSpy.mock.calls.join(" ")).toMatch(/Invalid skill id/);
  });

  it("rejects consecutive hyphens (mirrors the loader's validation)", () => {
    expect(() => runSkillNew("foo--bar", { description: "x", category: "general" }, tmp)).toThrow("process.exit(2)");
  });

  it("rejects an unknown category with exit code 2", () => {
    expect(() => runSkillNew("foo", { description: "x", category: "made-up" }, tmp)).toThrow("process.exit(2)");
    expect(errSpy.mock.calls.join(" ")).toMatch(/Invalid category/);
  });

  it("rejects an unknown harness with exit code 2", () => {
    // Cast through unknown to bypass the HarnessKey constraint at the test
    // boundary: we want to assert the runtime guard, not the type guard.
    expect(() =>
      runSkillNew("foo", { description: "x", category: "general", harness: "vscode" as unknown as "claude" }, tmp),
    ).toThrow("process.exit(2)");
    expect(errSpy.mock.calls.join(" ")).toMatch(/Unknown harness/);
  });

  it("refuses to overwrite an existing SKILL.md without --force (exit 1)", () => {
    const skillDir = path.join(tmp, ".claude", "skills", "existing");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "preserve me", "utf-8");

    expect(() => runSkillNew("existing", { description: "x", category: "general" }, tmp)).toThrow("process.exit(1)");
    expect(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8")).toBe("preserve me");
    expect(errSpy.mock.calls.join(" ")).toMatch(/already exists/);
  });

  it("overwrites an existing SKILL.md when --force is passed", () => {
    const skillDir = path.join(tmp, ".claude", "skills", "existing");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "old contents", "utf-8");

    runSkillNew("existing", { description: "new desc", category: "general", force: true }, tmp);
    const updated = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8");
    expect(updated).toContain("name: existing");
    expect(updated).toContain("description: new desc");
    expect(updated).not.toContain("old contents");
  });

  it("normalizes ids to lowercase before validating", () => {
    runSkillNew("MyCoolSkill", { description: "x", category: "general" }, tmp);
    expect(fs.existsSync(path.join(tmp, ".claude", "skills", "mycoolskill", "SKILL.md"))).toBe(true);
  });

  it("scaffolded SKILL.md is round-trippable through discovery", () => {
    runSkillNew("voyage-embeddings", { description: "Embed text via Voyage", category: "data" }, tmp);
    const result = discoverSkillsWithDiagnostics(tmp);
    expect(result.warnings).toEqual([]);
    const skill = result.skills.find((s) => s.id === "voyage-embeddings");
    expect(skill).toBeDefined();
    expect(skill?.category).toBe("data");
    expect(skill?.description).toBe("Embed text via Voyage");
  });
});

describe("runSkillList", () => {
  let tmp: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-skill-list-"));
    // --json writes via process.stdout.write; the human format uses console.log.
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    stdoutSpy.mockRestore();
    logSpy.mockRestore();
  });

  function jsonOutput(): Array<Record<string, unknown>> {
    const writes = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("");
    return JSON.parse(writes);
  }

  it("--json includes every built-in skill with kind=builtin", () => {
    runSkillList({ json: true }, tmp, {});
    const data = jsonOutput();
    const ids = data.filter((s) => s.kind === "builtin").map((s) => s.id);
    for (const expected of ["github", "linear", "slack", "sentry"]) {
      expect(ids).toContain(expected);
    }
  });

  it("--json marks a custom skill with kind=custom and merges it into the list", () => {
    runSkillNew("voyage-embeddings", { description: "Embed", category: "data" }, tmp);
    runSkillList({ json: true }, tmp, {});
    const data = jsonOutput();
    const custom = data.find((s) => s.id === "voyage-embeddings");
    expect(custom).toMatchObject({ id: "voyage-embeddings", kind: "custom", category: "data" });
  });

  it("--json marks configured=true when required env vars are set", () => {
    runSkillList({ json: true }, tmp, { GITHUB_TOKEN: "ghp_abc" });
    const data = jsonOutput();
    expect(data.find((s) => s.id === "github")?.configured).toBe(true);
    expect(data.find((s) => s.id === "linear")?.configured).toBe(false);
  });

  it("custom skill that overrides a built-in id appears once with kind=custom", () => {
    const skillDir = path.join(tmp, ".claude", "skills", "github");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: github\ndescription: Team-specific GitHub guidance\n---\nUse the corp instance.",
      "utf-8",
    );

    runSkillList({ json: true }, tmp, {});
    const data = jsonOutput();
    const githubEntries = data.filter((s) => s.id === "github");
    expect(githubEntries).toHaveLength(1);
    expect(githubEntries[0].kind).toBe("custom");
  });

  it("human output renders an 'Available skills' header and a scaffold hint", () => {
    runSkillList({}, tmp, {});
    const printed = logSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(printed).toContain("Available skills");
    expect(printed).toContain("sweny skill new");
  });
});
