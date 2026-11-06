import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerImplementCommand, registerTriageCommand } from "../cli/config.js";
import { SUPPORTED_AGENTS, unsupportedAgentError } from "../harness/agents.js";

/**
 * The hosted cloud service is an experiment that is not running and not open
 * for sign-ups. Documenting it as a shipped product costs credibility: a
 * reader who follows the instructions finds nothing behind them.
 *
 * This guard separates the two things that look similar in a grep:
 *
 *  - PROMOTION — "sign up", "copy your token", a dashboard link in a nav or a
 *    docs index. Not allowed anywhere.
 *  - DISCLOSURE — naming the endpoint the CLI posts to when the operator opts
 *    in. Required in PRIVACY.md, because a privacy policy that omits real
 *    network behavior is worse than one that mentions an unreleased service.
 *
 * If the service launches, delete this file rather than weakening it.
 */

const repoRoot = (() => {
  // Walk up from this test file until the directory holding the root docs.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "PRIVACY.md")) && existsSync(join(dir, "ARCHITECTURE.md"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("could not locate repo root from test file");
})();

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

/** Docs a prospective user reads. None of these may sell the service. */
const USER_FACING_DOCS = ["README.md", "ARCHITECTURE.md", "SECURITY.md", "docs/README.md"];

/** Phrases that only make sense if the service is open for business. */
const PROMOTIONAL_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bsign up\b/i, why: "there is no sign-up" },
  {
    pattern: /copy the \*\*CI reporting token\*\*|copy your (?:project |cloud )?token/i,
    why: "no token can be obtained",
  },
  { pattern: /\[Cloud Dashboard\]/i, why: "links a product that is not running" },
  { pattern: /link your repo/i, why: "implies an onboarding flow that does not exist" },
  { pattern: /what sweny cloud is/i, why: "frames the experiment as a shipped product" },
];

describe("docs do not promote the unreleased cloud service", () => {
  for (const doc of USER_FACING_DOCS) {
    for (const { pattern, why } of PROMOTIONAL_PATTERNS) {
      it(`${doc} avoids /${pattern.source}/ (${why})`, () => {
        expect(read(doc)).not.toMatch(pattern);
      });
    }
  }

  it("README does not link the cloud host", () => {
    // A bare mention is fine in prose; a clickable link is an advertisement.
    expect(read("README.md")).not.toMatch(/\]\(https:\/\/cloud\.sweny\.ai/);
  });

  it("README states the reporting path is unavailable", () => {
    const readme = read("README.md");
    expect(readme).toMatch(/not yet available|not open for sign-ups/i);
  });
});

describe("privacy disclosure is preserved", () => {
  // The inverse guard. Someone tidying up cloud references could strip the
  // policy that documents a real, shipping code path.
  it("PRIVACY.md still names the endpoint the CLI posts to", () => {
    expect(read("PRIVACY.md")).toMatch(/cloud\.sweny\.ai\/api\/report/);
  });

  it("PRIVACY.md still enumerates what the payload contains", () => {
    const privacy = read("PRIVACY.md");
    for (const field of ["Repository owner and name", "duration", "PR / issue URLs"]) {
      expect(privacy).toContain(field);
    }
  });

  it("PRIVACY.md flags that the service is not currently available", () => {
    expect(read("PRIVACY.md")).toMatch(/not currently available/i);
  });

  it("SECURITY.md states the opt-in gate rather than describing a dashboard", () => {
    const security = read("SECURITY.md");
    expect(security).toMatch(/SWENY_CLOUD_TOKEN/);
    expect(security).toMatch(/no outbound request|returns immediately/i);
  });
});

// ─── Docs honesty: what is documented is what ships ──────────────────

/** Markdown/MDX files under a repo-relative directory, recursively. */
function docFiles(rel: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.mdx?$/.test(entry.name)) out.push(next);
    }
  };
  walk(rel);
  return out;
}

/** The text of a `## heading` section, up to the next `## ` heading. */
function section(md: string, heading: string): string {
  const start = md.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`no "## ${heading}" section`);
  const rest = md.slice(start + 1);
  const next = rest.indexOf("\n## ", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

/** `--flag` names in the first column of a docs options table. */
function documentedFlags(md: string): string[] {
  return [...md.matchAll(/^\|\s*`(--[a-z0-9-]+)/gm)].map((m) => m[1]);
}

function helpFlags(cmd: Command): Set<string> {
  return new Set(cmd.helpInformation().match(/--[a-z0-9][a-z0-9-]*/g) ?? []);
}

/**
 * Flags that were parsed, defaulted and validated but never read by any code
 * (#332). They must stay out of --help and the docs until something consumes
 * them.
 */
const DEAD_FLAGS = [
  "--cache-dir",
  "--cache-ttl",
  "--no-cache",
  "--output-dir",
  "--service-map-path",
  "--gitlab-base-url",
  "--linear-team-id",
  "--linear-bug-label-id",
  "--linear-triage-label-id",
  "--linear-state-backlog",
  "--linear-state-in-progress",
  "--linear-state-peer-review",
];

describe("every documented CLI flag exists in --help", () => {
  const commands = read("packages/web/src/content/docs/cli/commands.md");
  const cases: Array<[string, string, Command]> = [
    ["triage", "sweny triage", registerTriageCommand(new Command())],
    ["implement", "sweny implement", registerImplementCommand(new Command())],
  ];

  for (const [name, heading, cmd] of cases) {
    it(`sweny ${name}: every flag in commands.md is registered`, () => {
      const documented = documentedFlags(section(commands, heading));
      expect(documented.length).toBeGreaterThan(5);
      const help = helpFlags(cmd);
      const missing = documented.filter((f) => !help.has(f));
      expect(missing).toEqual([]);
    });

    it(`sweny ${name}: --help carries no parsed-but-unread flag`, () => {
      const help = helpFlags(cmd);
      expect(DEAD_FLAGS.filter((f) => help.has(f))).toEqual([]);
    });
  }

  it("no docs page documents a parsed-but-unread flag", () => {
    const hits: string[] = [];
    for (const rel of ["README.md", ...docFiles("packages/web/src/content/docs/cli")]) {
      const text = read(rel);
      for (const flag of DEAD_FLAGS)
        if (text.includes(`${flag} `) || text.includes(`${flag}\``)) hits.push(`${rel}: ${flag}`);
    }
    expect(hits).toEqual([]);
  });
});

describe("README quickstart", () => {
  const readme = read("README.md");

  it("does not promote a deprecated command", () => {
    // Deprecated commands are registered in main.ts as
    // `<parent>Cmd.command("<name> ...").description("[DEPRECATED] ...")`.
    const main = read("packages/core/src/cli/main.ts");
    const deprecated = [...main.matchAll(/(\w+)Cmd\s*\.command\("(\w+)[^"]*"\)\s*\.description\("\[DEPRECATED\]/g)].map(
      (m) => `sweny ${m[1]} ${m[2]}`,
    );
    expect(deprecated).toContain("sweny workflow create");
    for (const cmd of deprecated) expect(readme, `README mentions deprecated "${cmd}"`).not.toContain(cmd);
  });

  it("states up front which credentials each agent needs", () => {
    const quickstart = section(readme, "Quickstart");
    for (const needle of [
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_API_KEY",
      "CODEX_API_KEY",
      "OPENAI_API_KEY",
      "codex login",
      "SWENY_ENV_PASSTHROUGH",
    ]) {
      expect(quickstart).toContain(needle);
    }
  });
});

describe("network claims match the code", () => {
  it("nothing says SWEny makes no network requests at all", () => {
    for (const doc of ["README.md", "packages/web/src/content/docs/getting-started/faq.md"]) {
      expect(read(doc), doc).not.toMatch(/no pings|nothing is sent to SWEny|zero phone-home/i);
    }
  });

  it("README and the CLI reference name the npm version check and how to turn it off", () => {
    for (const doc of ["README.md", "packages/web/src/content/docs/cli/commands.md"]) {
      const text = read(doc);
      expect(text, doc).toMatch(/npm registry/i);
      expect(text, doc).toContain("SWENY_NO_UPDATE_CHECK");
    }
  });
});

describe("ARCHITECTURE.md matches the repo", () => {
  const arch = read("ARCHITECTURE.md");

  it("lists only package directories that exist, and every package directory", () => {
    const table = arch.slice(arch.indexOf("### Packages"), arch.indexOf("### Execution Flow"));
    const dirs = [...table.matchAll(/`(packages\/[a-z-]+)`/g)].map((m) => m[1]);
    for (const dir of dirs) expect(existsSync(join(repoRoot, dir)), `${dir} does not exist`).toBe(true);
    const real = readdirSync(join(repoRoot, "packages"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => `packages/${e.name}`);
    for (const dir of real) expect(dirs, `${dir} is missing from the packages table`).toContain(dir);
  });

  it("does not describe a bundled action package (the action is a composite action.yml)", () => {
    expect(arch).not.toContain("@sweny-ai/action");
    expect(arch).not.toMatch(/bundled into root/i);
  });

  it("lists every catalog MCP server under its transport, and says stdio servers run @latest", () => {
    const catalog = read("packages/core/src/mcp-catalog.ts");
    const entries = [...catalog.matchAll(/\bid: "(\w+)",[\s\S]*?transport: "(stdio|http)"/g)].map((m) => ({
      id: m[1],
      transport: m[2],
    }));
    expect(entries.filter((e) => e.transport === "stdio").length).toBeGreaterThan(0);
    expect(entries.filter((e) => e.transport === "http").length).toBeGreaterThan(0);
    // "Currently stdio (via ...): ..." and "Currently http (...): ..." paragraphs.
    const flat = (t: string) => t.toLowerCase().replace(/[^a-z]/g, "");
    const stdioDoc = flat(arch.slice(arch.indexOf("Currently stdio"), arch.indexOf("Currently http")));
    const httpDoc = flat(arch.slice(arch.indexOf("Currently http"), arch.indexOf("Users can override")));
    for (const { id, transport } of entries) {
      expect(transport === "stdio" ? stdioDoc : httpDoc, `${id} (${transport}) missing from ARCHITECTURE.md`).toContain(
        id,
      );
    }
    expect(arch).toMatch(/@latest/);
  });
});

describe("spec and docs wording is harness-neutral", () => {
  // Routing, evaluation and tool deny work on every supported agent, so the
  // spec and the docs may not tie them to Claude.
  const CLAUDE_ONLY: RegExp[] = [
    /Claude evaluates/,
    /Claude decides/,
    /Claude Agent SDK/,
    /Claude Code SDK/,
    /disallowedTools/,
    /calls a small Claude model/i,
    /Default `claude-haiku-4-5`/,
  ];
  const pages = [...docFiles("spec/src/content/docs"), ...docFiles("packages/web/src/content/docs")];

  it("scans the pages", () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  for (const pattern of CLAUDE_ONLY) {
    it(`no page matches /${pattern.source}/`, () => {
      expect(pages.filter((p) => pattern.test(read(p)))).toEqual([]);
    });
  }
});

describe("unsupportedAgentError lists the agents the docs list", () => {
  it("names every supported agent id and the acp:<command> form", () => {
    const message = unsupportedAgentError("gemini");
    for (const id of SUPPORTED_AGENTS) expect(message).toContain(`"${id}"`);
    expect(message).toContain('"acp:<command>"');
    expect(read("README.md")).toContain("acp:<command>");
  });
});

describe("supported agents are listed the same way everywhere", () => {
  const PAGES = [
    "README.md",
    "packages/web/src/content/docs/cli/commands.md",
    "packages/web/src/content/docs/getting-started/faq.md",
    "packages/web/src/content/docs/getting-started/agents-and-policies.md",
  ];

  for (const page of PAGES) {
    it(`${page} names every agent id and the acp:<command> form`, () => {
      const text = read(page);
      for (const id of SUPPORTED_AGENTS) expect(text, `${id}`).toMatch(new RegExp(`\\b${id}\\b`, "i"));
      expect(text).toContain("acp:");
    });
  }
});
