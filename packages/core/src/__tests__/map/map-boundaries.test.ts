/**
 * Map nodes stay harness-neutral and skill-neutral (#575, RFC 0002 §7): hosts
 * inject journals and harnesses; map.ts and map-spec.ts never import an
 * adapter, the CLI or a skill, and never name a harness or a skill.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { builtinSkills } from "../../skills/index.js";

const FILES = ["map.ts", "map-spec.ts"] as const;
const read = (f: string) => readFileSync(fileURLToPath(new URL(`../../${f}`, import.meta.url)), "utf8");
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const HARNESS_IDS = ["claude", "claude-code", "codex", "pi", "acp"];

describe.each(FILES)("%s", (file) => {
  const src = read(file);
  const code = codeOf(src);
  const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);

  it("imports no harness adapter, no CLI code and no skill", () => {
    const bad = imports.filter(
      (p) =>
        p.startsWith("./cli/") ||
        p.startsWith("./skills/") ||
        (p.startsWith("./harness/") && p !== "./harness/types.js"),
    );
    expect(bad).toEqual([]);
  });

  it("names no harness and no skill in code", () => {
    const ids = [...HARNESS_IDS, ...builtinSkills.map((s) => s.id)];
    const named = ids.filter((id) =>
      new RegExp(`["'\`]${id.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}["'\`]`).test(code),
    );
    expect(named).toEqual([]);
  });
});

describe("the child-run host", () => {
  it("builds harnesses only through what its caller injects", () => {
    const code = codeOf(read("child-host.ts"));
    expect(code).not.toMatch(/createHarness|from "\.\/harness\/(?!types\.js)/);
    expect(code).toContain("opts.harness?.()");
  });
});
