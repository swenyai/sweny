import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { execSync } from "node:child_process";

/**
 * Version consistency tests — ensure the v5 migration is complete
 * and prevent regressions when the action version changes.
 *
 * These tests validate that:
 * 1. No stale v4 action references remain in source or docs
 * 2. The README uses dark-mode-safe logo rendering
 * 3. The CLI init wizard generates the correct action version
 * 4. Docs code blocks don't mix the generic action with triage-only inputs
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const CURRENT_ACTION_VERSION = "v5";

/** The previous action version — split into pieces so git grep doesn't match this file */
const PREV_VERSION = `v${"4"}`;

/** Files that are historical records — allowed to reference old versions */
const HISTORICAL_GLOBS = ["docs/superpowers/", ".tasks/", "node_modules/", ".changeset/", "CHANGELOG"];

function isHistorical(filePath: string): boolean {
  const rel = relative(ROOT, filePath);
  return HISTORICAL_GLOBS.some((g) => rel.startsWith(g));
}

/**
 * Use git grep for fast, indexed search across the repo.
 * Returns array of "file:line:content" strings.
 */
function gitGrep(pattern: string, extraArgs: string[] = []): string[] {
  try {
    const result = execSync(`git grep -n "${pattern}" -- . ${extraArgs.map((a) => `"${a}"`).join(" ")}`, {
      cwd: ROOT,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return result.trim().split("\n").filter(Boolean);
  } catch {
    // git grep exits 1 when no matches — that's fine
    return [];
  }
}

// ─── 1. No stale v4 references ──────────────────────────────────────

describe("action version consistency", () => {
  it(`has no swenyai/sweny@${PREV_VERSION} references in source or docs`, () => {
    const matches = gitGrep(`swenyai/sweny@${PREV_VERSION}`);
    const live = matches.filter((m) => {
      const file = resolve(ROOT, m.split(":")[0]);
      return !isHistorical(file);
    });

    if (live.length > 0) {
      const summary = live
        .map((m) => {
          const [f, line] = m.split(":");
          return `  ${f}:${line}`;
        })
        .join("\n");
      expect.fail(
        `Found ${live.length} stale swenyai/sweny@${PREV_VERSION} reference(s):\n${summary}\n\n` +
          `All live references should use swenyai/sweny@${CURRENT_ACTION_VERSION}`,
      );
    }
  });

  it("CLAUDE.md references the current action version", () => {
    const claude = readFileSync(resolve(ROOT, "CLAUDE.md"), "utf-8");
    expect(claude).toContain(`swenyai/sweny@${CURRENT_ACTION_VERSION}`);
    expect(claude).not.toContain(`swenyai/sweny@${PREV_VERSION}`);
  });

  it("CLAUDE.md package table references the current version", () => {
    const claude = readFileSync(resolve(ROOT, "CLAUDE.md"), "utf-8");
    expect(claude).toMatch(new RegExp(`@sweny-ai/core.*${CURRENT_ACTION_VERSION}`));
  });

  it("CLI init generates workflows with the current action version", () => {
    const initSrc = readFileSync(resolve(ROOT, "packages/core/src/cli/init.ts"), "utf-8");
    expect(initSrc).toContain(`swenyai/sweny@${CURRENT_ACTION_VERSION}`);
    expect(initSrc).not.toContain(`swenyai/sweny@${PREV_VERSION}`);
  });
});

// ─── 2. README quality ──────────────────────────────────────────────

describe("README", () => {
  const readme = readFileSync(resolve(ROOT, "README.md"), "utf-8");

  it("uses <picture> element for dark mode logo", () => {
    expect(readme).toContain("<picture>");
    expect(readme).toContain("prefers-color-scheme: dark");
    expect(readme).toContain("prefers-color-scheme: light");
  });

  it("maps dark scheme to light logo and light scheme to dark logo", () => {
    // Dark background needs light (white) text logo
    expect(readme).toMatch(/prefers-color-scheme:\s*dark.*logo-lockup-light\.svg/s);
    // Light background needs dark text logo
    expect(readme).toMatch(/prefers-color-scheme:\s*light.*logo-lockup-dark\.svg/s);
  });

  it("references both logo assets that exist on disk", () => {
    expect(existsSync(resolve(ROOT, "assets/logo-lockup-dark.svg"))).toBe(true);
    expect(existsSync(resolve(ROOT, "assets/logo-lockup-light.svg"))).toBe(true);
  });

  it("does not use the old Recipes heading", () => {
    expect(readme).not.toMatch(/^## Recipes$/m);
  });

  it("has an Actions section with the multi-repo table", () => {
    expect(readme).toMatch(/^## Actions$/m);
    expect(readme).toContain("swenyai/triage@v1");
    expect(readme).toContain("swenyai/e2e@v1");
    expect(readme).toContain(`swenyai/sweny@${CURRENT_ACTION_VERSION}`);
  });
});

// ─── 3. action.yml describes a generic workflow runner ──────────────

describe("action.yml", () => {
  const actionYml = readFileSync(resolve(ROOT, "action.yml"), "utf-8");

  it("has a description under 125 characters", () => {
    const match = actionYml.match(/^description:\s*"(.+)"$/m);
    expect(match).not.toBeNull();
    expect(match![1].length).toBeLessThan(125);
  });

  it("requires a workflow input", () => {
    expect(actionYml).toContain("workflow:");
  });

  it("does not have triage-specific inputs", () => {
    // These belong on swenyai/triage, not the generic runner
    const triageInputs = [
      "observability-provider",
      "sentry-auth-token",
      "dd-api-key",
      "dd-app-key",
      "issue-tracker-provider",
      "linear-api-key",
      "dry-run",
      "time-range",
      "severity-focus",
    ];
    for (const input of triageInputs) {
      expect(actionYml).not.toContain(`${input}:`);
    }
  });

  it("runs sweny workflow run", () => {
    expect(actionYml).toMatch(/sweny workflow run/);
  });
});

// ─── 4. Docs code blocks don't mix generic action with triage inputs ─

describe("docs action code blocks", () => {
  const TRIAGE_ONLY_INPUTS = [
    "observability-provider",
    "sentry-auth-token",
    "sentry-org",
    "sentry-project",
    "dd-api-key",
    "dd-app-key",
    "issue-tracker-provider",
    "linear-api-key",
    "linear-team-id",
    "dry-run:",
    "time-range",
    "severity-focus",
    "service-filter",
    "investigation-depth",
  ];

  /**
   * Extract YAML code blocks that reference swenyai/sweny@v5
   * and check they don't use triage-only inputs.
   */
  function findMisusedBlocks(filePath: string): string[] {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    const blocks = content.match(/```ya?ml[\s\S]*?```/g) || [];
    const issues: string[] = [];

    for (const block of blocks) {
      if (!block.includes(`swenyai/sweny@${CURRENT_ACTION_VERSION}`)) continue;
      for (const input of TRIAGE_ONLY_INPUTS) {
        if (block.includes(input)) {
          issues.push(
            `${relative(ROOT, filePath)}: code block uses swenyai/sweny@${CURRENT_ACTION_VERSION} with triage-only input "${input}"`,
          );
          break; // one issue per block is enough
        }
      }
    }
    return issues;
  }

  // These are the docs files that show GitHub Action examples
  const ACTION_DOC_FILES = [
    "packages/web/src/content/docs/action/index.md",
    "packages/web/src/content/docs/action/examples.md",
    "packages/web/src/content/docs/action/scheduling.md",
    "packages/web/src/content/docs/action/inputs.md",
    "packages/web/src/content/docs/action/service-map.md",
    "packages/web/src/content/docs/index.mdx",
    "packages/web/src/content/docs/getting-started/quick-start.md",
    "packages/web/src/content/docs/workflows/triage.md",
    "packages/web/src/content/docs/workflows/implement.md",
    "packages/web/src/content/docs/cloud/getting-started.mdx",
    "packages/web/src/content/docs/advanced/mcp-servers.md",
    "packages/web/src/content/docs/advanced/troubleshooting.md",
  ];

  it("no docs code block uses swenyai/sweny@v5 with triage-only inputs", () => {
    const allIssues = ACTION_DOC_FILES.flatMap((f) => findMisusedBlocks(resolve(ROOT, f)));
    if (allIssues.length > 0) {
      expect.fail(
        `Found ${allIssues.length} code block(s) mixing swenyai/sweny@${CURRENT_ACTION_VERSION} with triage-only inputs:\n` +
          allIssues.map((i) => `  ${i}`).join("\n"),
      );
    }
  });

  it("every swenyai/sweny@v5 code block has a workflow: input", () => {
    const issues: string[] = [];
    for (const f of ACTION_DOC_FILES) {
      const filePath = resolve(ROOT, f);
      if (!existsSync(filePath)) continue;
      const content = readFileSync(filePath, "utf-8");
      const blocks = content.match(/```ya?ml[\s\S]*?```/g) || [];
      for (const block of blocks) {
        if (!block.includes(`swenyai/sweny@${CURRENT_ACTION_VERSION}`)) continue;
        if (!block.includes("workflow:")) {
          issues.push(
            `${relative(ROOT, filePath)}: code block uses swenyai/sweny@${CURRENT_ACTION_VERSION} without workflow: input`,
          );
        }
      }
    }
    if (issues.length > 0) {
      expect.fail(`The generic runner requires a workflow: input.\n` + issues.map((i) => `  ${i}`).join("\n"));
    }
  });
});

// ─── 5. Internal doc links resolve ──────────────────────────────────

describe("docs internal links", () => {
  const DOCS_ROOT = resolve(ROOT, "packages/web/src/content/docs");

  /**
   * Extract markdown links like [text](/path/) and verify the target exists.
   * Only checks internal absolute links (starting with /).
   */
  function findBrokenLinks(filePath: string): string[] {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    const broken: string[] = [];

    // Match [text](/path/) and [text](/path/#anchor) but skip external URLs
    const linkPattern = /\[([^\]]*)\]\(\/([^)#]*?)\/?\)/g;
    let match;
    while ((match = linkPattern.exec(content)) !== null) {
      const linkPath = match[2];
      // Map /action/ → action/index.md, /action/inputs/ → action/inputs.md
      const candidates = [
        resolve(DOCS_ROOT, linkPath, "index.md"),
        resolve(DOCS_ROOT, linkPath, "index.mdx"),
        resolve(DOCS_ROOT, `${linkPath}.md`),
        resolve(DOCS_ROOT, `${linkPath}.mdx`),
      ];
      if (!candidates.some((c) => existsSync(c))) {
        broken.push(`${relative(ROOT, filePath)}: broken link [${match[1]}](/${linkPath}/)`);
      }
    }
    return broken;
  }

  const KEY_DOCS = [
    "packages/web/src/content/docs/action/index.md",
    "packages/web/src/content/docs/action/inputs.md",
    "packages/web/src/content/docs/action/examples.md",
    "packages/web/src/content/docs/action/scheduling.md",
    "packages/web/src/content/docs/action/service-map.md",
    "packages/web/src/content/docs/index.mdx",
    "packages/web/src/content/docs/getting-started/quick-start.md",
  ];

  it("key action docs have no broken internal links", () => {
    const allBroken = KEY_DOCS.flatMap((f) => findBrokenLinks(resolve(ROOT, f)));
    if (allBroken.length > 0) {
      expect.fail(`Found ${allBroken.length} broken link(s):\n` + allBroken.map((b) => `  ${b}`).join("\n"));
    }
  });
});

// ─── 6. Three-action architecture documented ────────────────────────

describe("three-action architecture", () => {
  it("action/index.md documents all three actions", () => {
    const content = readFileSync(resolve(ROOT, "packages/web/src/content/docs/action/index.md"), "utf-8");
    expect(content).toContain("swenyai/triage@v1");
    expect(content).toContain("swenyai/e2e@v1");
    expect(content).toContain(`swenyai/sweny@${CURRENT_ACTION_VERSION}`);
  });

  it("action/inputs.md has sections for all three actions", () => {
    const content = readFileSync(resolve(ROOT, "packages/web/src/content/docs/action/inputs.md"), "utf-8");
    expect(content).toMatch(/## Generic runner inputs/);
    expect(content).toMatch(/## Triage action inputs/);
    expect(content).toMatch(/## E2E action inputs/);
  });

  it("README Actions table lists all three actions", () => {
    const readme = readFileSync(resolve(ROOT, "README.md"), "utf-8");
    expect(readme).toContain("swenyai/triage@v1");
    expect(readme).toContain("swenyai/e2e@v1");
    expect(readme).toContain(`swenyai/sweny@${CURRENT_ACTION_VERSION}`);
  });
});
