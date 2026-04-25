import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";

import { renderSkillTemplate } from "../skill.js";
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
});
