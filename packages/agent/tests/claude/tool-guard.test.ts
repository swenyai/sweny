import { describe, it, expect } from "vitest";
import { DENIED_TOOLS, CONFIRMATION_REQUIRED_TOOLS } from "../../src/claude/tool-guard.js";

// ---------------------------------------------------------------------------
// DENIED_TOOLS
// ---------------------------------------------------------------------------

describe("DENIED_TOOLS", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(DENIED_TOOLS)).toBe(true);
    expect(DENIED_TOOLS.length).toBeGreaterThan(0);
  });

  it("contains NotebookEdit", () => {
    expect(DENIED_TOOLS).toContain("NotebookEdit");
  });

  it("does not contain allowed tools (Bash, Write, Edit, Read)", () => {
    const allowedTools = ["Bash", "Write", "Edit", "Read"];
    for (const tool of allowedTools) {
      expect(DENIED_TOOLS).not.toContain(tool);
    }
  });

  it("contains only strings", () => {
    for (const tool of DENIED_TOOLS) {
      expect(typeof tool).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// CONFIRMATION_REQUIRED_TOOLS
// ---------------------------------------------------------------------------

describe("CONFIRMATION_REQUIRED_TOOLS", () => {
  it("is an empty array (no confirmation-required tools in current phase)", () => {
    expect(Array.isArray(CONFIRMATION_REQUIRED_TOOLS)).toBe(true);
    expect(CONFIRMATION_REQUIRED_TOOLS).toHaveLength(0);
  });

  it("is an array of strings", () => {
    expect(Array.isArray(CONFIRMATION_REQUIRED_TOOLS)).toBe(true);
    // Even though it's empty now, verify the type contract holds.
    for (const tool of CONFIRMATION_REQUIRED_TOOLS) {
      expect(typeof tool).toBe("string");
    }
  });
});
