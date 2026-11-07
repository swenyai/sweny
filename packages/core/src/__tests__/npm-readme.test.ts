import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The npm page for @sweny-ai/core is the highest-intent landing a visitor
 * sees (#534). It must ship a README, and the README must lead with the one
 * path: `npx @sweny-ai/core new`, credentials by agent, a receipt, the docs.
 */

const CORE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(readFileSync(join(CORE_DIR, "package.json"), "utf-8")) as {
  files: string[];
  description: string;
  keywords: string[];
};
const rootReadme = readFileSync(join(CORE_DIR, "..", "..", "README.md"), "utf-8");
const readme = existsSync(join(CORE_DIR, "README.md")) ? readFileSync(join(CORE_DIR, "README.md"), "utf-8") : "";

/** Commands registered as `.command("<name> ...").description("[DEPRECATED] ...")`. */
const main = readFileSync(join(CORE_DIR, "src", "cli", "main.ts"), "utf-8");
const deprecated = [...main.matchAll(/(\w+)Cmd\s*\.command\("(\w+)[^"]*"\)\s*\.description\("\[DEPRECATED\]/g)].map(
  (m) => `sweny ${m[1]} ${m[2]}`,
);

describe("@sweny-ai/core npm README", () => {
  it("exists next to package.json and the published files include it", () => {
    expect(existsSync(join(CORE_DIR, "README.md"))).toBe(true);
    expect(pkg.files).toContain("README.md");
    expect(pkg.files).toContain("dist");
  });

  it("the npm description is the project tagline, verbatim from the root README hero", () => {
    const hero = rootReadme.match(/<strong>([^<]+)<\/strong>/)?.[1];
    expect(hero).toBeTruthy();
    expect(pkg.description).toBe(hero);
    expect(readme).toContain(pkg.description);
  });

  it("keywords are what an engineer would search for", () => {
    for (const k of ["ai-agents", "coding-agents", "claude-code", "codex", "workflow", "github-action", "sandbox"]) {
      expect(pkg.keywords).toContain(k);
    }
  });

  it("is short enough to scan", () => {
    expect(readme.split("\n").length).toBeLessThan(90);
  });

  it("opens with the one-line pitch (the tagline)", () => {
    expect(readme).toContain("Workflows for coding agents. One set of rules, a receipt for every run.");
  });

  it("leads with `npx @sweny-ai/core new`, then check, then run, before the credentials table", () => {
    const iNew = readme.indexOf("npx @sweny-ai/core new");
    const iCheck = readme.indexOf("@sweny-ai/core check");
    const iRun = readme.indexOf("workflow run");
    const iCreds = readme.indexOf("## Credentials");
    expect(iNew).toBeGreaterThan(-1);
    expect(iNew).toBeLessThan(iCheck);
    expect(iCheck).toBeLessThan(iRun);
    expect(iRun).toBeLessThan(iCreds);
  });

  it("labels `sweny try` a replay demo, not a real run", () => {
    expect(readme).toMatch(/sweny try[^\n]*replay/i);
    expect(readme).toMatch(/not a real run/i);
  });

  it("states credentials per agent", () => {
    for (const needle of [
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_API_KEY",
      "CODEX_API_KEY",
      "OPENAI_API_KEY",
      "codex login",
      "SWENY_ENV_PASSTHROUGH",
    ]) {
      expect(readme).toContain(needle);
    }
  });

  it("shows a receipt and what comes after it", () => {
    expect(readme).toContain("╭┄");
    expect(readme).toContain("[ ENV SCOPED · SANDBOXED ]");
    expect(readme).toContain("sweny runs diff");
  });

  it("links the docs with absolute URLs (relative links break on npmjs.com)", () => {
    expect(readme).toContain("https://docs.sweny.ai/getting-started/quick-start/");
    expect(readme).toContain("https://docs.sweny.ai/cli/commands/");
    expect(readme).not.toMatch(/\]\((?!https?:|#)[^)]+\)/);
  });

  it("does not promote a deprecated command", () => {
    expect(deprecated).toContain("sweny workflow create");
    for (const cmd of deprecated) expect(readme, `mentions deprecated "${cmd}"`).not.toContain(cmd);
  });

  it("carries no em-dashes", () => {
    expect(readme).not.toContain("—");
  });
});
