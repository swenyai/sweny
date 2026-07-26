import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
