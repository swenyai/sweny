import { describe, it, expect } from "vitest";
import { assessRisk } from "./risk-assessor.js";

describe("assessRisk", () => {
  it("returns low for normal source files", () => {
    const result = assessRisk(["src/foo.ts", "src/bar.ts"]);
    expect(result.level).toBe("low");
    expect(result.reasons).toHaveLength(0);
  });

  it("returns high for migration files", () => {
    const result = assessRisk(["src/migrations/001.sql"]);
    expect(result.level).toBe("high");
    expect(result.reasons.some((r) => r.includes("migrations"))).toBe(true);
  });

  it("returns high for package.json", () => {
    const result = assessRisk(["package.json"]);
    expect(result.level).toBe("high");
    expect(result.reasons.some((r) => r.includes("package.json"))).toBe(true);
  });

  it("returns high for .github/workflows files", () => {
    const result = assessRisk([".github/workflows/ci.yml"]);
    expect(result.level).toBe("high");
    expect(result.reasons.some((r) => r.includes(".github/workflows/ci.yml"))).toBe(true);
  });

  it("returns high when > 20 countable files changed", () => {
    const files = Array.from({ length: 21 }, (_, i) => `src/file${i}.ts`);
    const result = assessRisk(files);
    expect(result.level).toBe("high");
    expect(result.reasons.some((r) => r.includes("Large change scope"))).toBe(true);
  });

  it("excludes analysis artifacts, docs, and dist from the file count", () => {
    // 15 real code files + many excluded files — should stay low
    const codeFiles = Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`);
    const excluded = [
      ".github/triage-analysis/best-candidate.md",
      ".github/triage-analysis/investigation-log.md",
      ".github/triage-analysis/issues-report.md",
      "README.md",
      "CHANGELOG.md",
      "dist/index.js",
      "dist/index.d.ts",
      "dist/index.js.map",
    ];
    const result = assessRisk([...codeFiles, ...excluded]);
    expect(result.level).toBe("low");
  });

  it("does not suppress high-risk pattern matches even for excluded-count files", () => {
    // A .md file in a migrations folder is still high-risk by pattern
    const result = assessRisk(["src/migrations/README.md"]);
    expect(result.level).toBe("high");
  });

  it("returns multiple reasons when multiple risk factors apply", () => {
    const files = ["package.json", "src/migrations/001.sql", ".github/workflows/ci.yml"];
    const result = assessRisk(files);
    expect(result.level).toBe("high");
    expect(result.reasons.length).toBeGreaterThan(1);
  });

  it("returns high for lockfiles", () => {
    expect(assessRisk(["package-lock.json"]).level).toBe("high");
    expect(assessRisk(["pnpm-lock.yaml"]).level).toBe("high");
    expect(assessRisk(["yarn.lock"]).level).toBe("high");
  });

  it("returns high for schema files", () => {
    expect(assessRisk(["db/schema.sql"]).level).toBe("high");
    expect(assessRisk(["src/schema.prisma"]).level).toBe("high");
  });

  it("returns low for empty file list", () => {
    const result = assessRisk([]);
    expect(result.level).toBe("low");
    expect(result.reasons).toHaveLength(0);
  });

  it("returns high for auth/ directory", () => {
    expect(assessRisk(["src/auth/jwt.ts"]).level).toBe("high");
    expect(assessRisk(["services/auth/handler.ts"]).level).toBe("high");
  });

  it("returns high for crypto/ directory", () => {
    expect(assessRisk(["src/crypto/cipher.ts"]).level).toBe("high");
  });

  it("returns high for security/ directory", () => {
    expect(assessRisk(["lib/security/policy.ts"]).level).toBe("high");
  });

  it("exactly 20 countable files stays low", () => {
    const files = Array.from({ length: 20 }, (_, i) => `src/file${i}.ts`);
    expect(assessRisk(files).level).toBe("low");
  });

  it("exactly 21 countable files is high", () => {
    const files = Array.from({ length: 21 }, (_, i) => `src/file${i}.ts`);
    expect(assessRisk(files).level).toBe("high");
  });

  it("returns high for nested package.json", () => {
    expect(assessRisk(["packages/foo/package.json"]).level).toBe("high");
  });

  it("returns high for nested lockfiles", () => {
    expect(assessRisk(["packages/foo/package-lock.json"]).level).toBe("high");
    expect(assessRisk(["services/bar/pnpm-lock.yaml"]).level).toBe("high");
    expect(assessRisk(["apps/ui/yarn.lock"]).level).toBe("high");
  });
});
