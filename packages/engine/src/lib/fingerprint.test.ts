import { describe, it, expect } from "vitest";
import { fingerprintEvent } from "./fingerprint.js";

describe("fingerprintEvent", () => {
  it("returns the same hash for the same fields", () => {
    const a = fingerprintEvent({ repo: "org/repo", filter: "auth" });
    const b = fingerprintEvent({ repo: "org/repo", filter: "auth" });
    expect(a).toBe(b);
  });

  it("returns a different hash for different field values", () => {
    const a = fingerprintEvent({ repo: "org/repo", filter: "auth" });
    const b = fingerprintEvent({ repo: "org/repo", filter: "payments" });
    expect(a).not.toBe(b);
  });

  it("is stable regardless of key insertion order", () => {
    const a = fingerprintEvent({ repo: "org/repo", filter: "auth", time: "1h" });
    const b = fingerprintEvent({ time: "1h", filter: "auth", repo: "org/repo" });
    expect(a).toBe(b);
  });

  it("normalises undefined values to empty string", () => {
    const a = fingerprintEvent({ repo: "org/repo", override: undefined });
    const b = fingerprintEvent({ repo: "org/repo", override: "" });
    expect(a).toBe(b);
  });

  it("returns a 16-character hex string", () => {
    const fp = fingerprintEvent({ x: "y" });
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });
});
