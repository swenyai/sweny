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

  it("returns high when > 10 files changed", () => {
    const files = Array.from({ length: 11 }, (_, i) => `src/file${i}.ts`);
    const result = assessRisk(files);
    expect(result.level).toBe("high");
    expect(result.reasons.some((r) => r.includes("Large change scope"))).toBe(true);
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
});
