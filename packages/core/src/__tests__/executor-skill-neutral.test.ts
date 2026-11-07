/**
 * The executor treats every skill the same (#536). A tool's behavior lives in
 * its skill, reading ToolContext; the executor never branches on a tool or
 * skill name. A grep is enough to hold the line.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { builtinSkills } from "../skills/index.js";

const source = readFileSync(fileURLToPath(new URL("../executor.ts", import.meta.url)), "utf8");
// Comments may name a tool to explain a seam; code may not.
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("executor.ts is skill-neutral", () => {
  it("names no built-in tool in code", () => {
    const named = builtinSkills
      .flatMap((s) => s.tools.map((t) => t.name))
      .filter((name) => new RegExp(`["'\`]${name}["'\`]`).test(code));
    expect(named).toEqual([]);
  });

  it("carries no PR-comment logic of its own", () => {
    for (const word of ["prComment", "pr-comment", "pr_number", "swenyCommentStatus", "issue_number"]) {
      expect(code).not.toContain(word);
    }
  });

  it("hands every tool the same run context", () => {
    expect(code).toContain("toolRunContext(workflow.id, runEnv)");
    expect(code.match(/\.\.\.runToolContext/g)).toHaveLength(2);
  });
});
