import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";

vi.mock("node:fs", () => ({
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedReadFileSync = vi.mocked(readFileSync);

// Import after mocking
const { discoverSkills, discoverSkillsWithDiagnostics } = await import("../skills/custom-loader.js");

describe("custom-loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("config parsing from SKILL.md frontmatter", () => {
    it("parses config fields from frontmatter", () => {
      const skillMd = `---
name: tax-tool
description: Processes tax filings
config:
  MY_TAX_API_KEY:
    description: API key for the tax service
    required: true
  MY_TAX_REGION:
    description: Tax region code
    required: false
---
Do tax stuff.
`;

      mockedExistsSync.mockImplementation((p) => {
        const s = String(p);
        return s.endsWith(".sweny/skills") || s.endsWith("tax-tool/SKILL.md");
      });
      mockedReaddirSync.mockReturnValue([{ name: "tax-tool", isDirectory: () => true } as any]);
      mockedReadFileSync.mockReturnValue(skillMd);

      const skills = discoverSkills("/fake");
      expect(skills).toHaveLength(1);
      const skill = skills[0];

      expect(skill.id).toBe("tax-tool");
      expect(skill.config).toEqual({
        MY_TAX_API_KEY: {
          description: "API key for the tax service",
          required: true,
          env: "MY_TAX_API_KEY",
        },
        MY_TAX_REGION: {
          description: "Tax region code",
          required: false,
          env: "MY_TAX_REGION",
        },
      });
    });

    it("produces config: {} when no config block in frontmatter", () => {
      const skillMd = `---
name: simple-skill
description: A simple skill
---
Instructions here.
`;

      mockedExistsSync.mockImplementation((p) => {
        const s = String(p);
        return s.endsWith(".sweny/skills") || s.endsWith("simple-skill/SKILL.md");
      });
      mockedReaddirSync.mockReturnValue([{ name: "simple-skill", isDirectory: () => true } as any]);
      mockedReadFileSync.mockReturnValue(skillMd);

      const skills = discoverSkills("/fake");
      expect(skills).toHaveLength(1);
      expect(skills[0].config).toEqual({});
    });

    it("sets env field to the key name automatically", () => {
      const skillMd = `---
name: my-api
description: API skill
config:
  CUSTOM_API_TOKEN:
    description: Token for the API
    required: true
---
Use the API.
`;

      mockedExistsSync.mockImplementation((p) => {
        const s = String(p);
        return s.endsWith(".sweny/skills") || s.endsWith("my-api/SKILL.md");
      });
      mockedReaddirSync.mockReturnValue([{ name: "my-api", isDirectory: () => true } as any]);
      mockedReadFileSync.mockReturnValue(skillMd);

      const skills = discoverSkills("/fake");
      expect(skills[0].config.CUSTOM_API_TOKEN.env).toBe("CUSTOM_API_TOKEN");
    });

    // Fix #9: broken skills are silently skipped today. Diagnostics make
    // configuration mistakes debuggable without changing the fail-open default.
    it("reports a warning when frontmatter is malformed YAML", () => {
      const skillMd = "---\nname: broken\ndescription: bad\n  config: [unclosed\n---\nBody";
      mockedExistsSync.mockImplementation((p) => {
        const s = String(p);
        return s.endsWith(".sweny/skills") || s.endsWith("broken/SKILL.md");
      });
      mockedReaddirSync.mockReturnValue([{ name: "broken", isDirectory: () => true } as any]);
      mockedReadFileSync.mockReturnValue(skillMd);

      const { skills, warnings } = discoverSkillsWithDiagnostics("/fake");
      expect(skills).toHaveLength(0);
      expect(warnings.some((w) => w.kind === "invalid-frontmatter")).toBe(true);
    });

    it("reports a warning when the skill id is invalid", () => {
      const skillMd = "---\nname: Bad_Name--X\ndescription: d\n---\nBody\n";
      mockedExistsSync.mockImplementation((p) => {
        const s = String(p);
        return s.endsWith(".sweny/skills") || s.endsWith("Bad_Name--X/SKILL.md");
      });
      mockedReaddirSync.mockReturnValue([{ name: "Bad_Name--X", isDirectory: () => true } as any]);
      mockedReadFileSync.mockReturnValue(skillMd);

      const { skills, warnings } = discoverSkillsWithDiagnostics("/fake");
      expect(skills).toHaveLength(0);
      expect(warnings.some((w) => w.kind === "invalid-id")).toBe(true);
    });

    it("discoverSkills (legacy) still returns plain Skill[] without diagnostics", () => {
      const skillMd = "---\nname: x\ndescription: y\n---\nok\n";
      mockedExistsSync.mockImplementation((p) => {
        const s = String(p);
        return s.endsWith(".sweny/skills") || s.endsWith("x/SKILL.md");
      });
      mockedReaddirSync.mockReturnValue([{ name: "x", isDirectory: () => true } as any]);
      mockedReadFileSync.mockReturnValue(skillMd);

      const skills = discoverSkills("/fake");
      expect(Array.isArray(skills)).toBe(true);
      expect(skills).toHaveLength(1);
    });

    it("handles config entries with missing description gracefully", () => {
      const skillMd = `---
name: sparse-config
description: Sparse config skill
config:
  SOME_KEY:
    required: true
---
Body.
`;

      mockedExistsSync.mockImplementation((p) => {
        const s = String(p);
        return s.endsWith(".sweny/skills") || s.endsWith("sparse-config/SKILL.md");
      });
      mockedReaddirSync.mockReturnValue([{ name: "sparse-config", isDirectory: () => true } as any]);
      mockedReadFileSync.mockReturnValue(skillMd);

      const skills = discoverSkills("/fake");
      expect(skills).toHaveLength(1);
      // Falls back to key name as description
      expect(skills[0].config.SOME_KEY.description).toBe("SOME_KEY");
      expect(skills[0].config.SOME_KEY.required).toBe(true);
      expect(skills[0].config.SOME_KEY.env).toBe("SOME_KEY");
    });
  });
});
