import { describe, it, expect } from "vitest";
import { classifySource } from "./sources.js";

describe("classifySource", () => {
  it("classifies http(s) URLs as url", () => {
    expect(classifySource("http://example.com/x.md")).toBe("url");
    expect(classifySource("https://example.com/x.md")).toBe("url");
  });

  it("classifies ./ ../ and / paths as file", () => {
    expect(classifySource("./local.md")).toBe("file");
    expect(classifySource("../sibling.md")).toBe("file");
    expect(classifySource("/abs/path.md")).toBe("file");
  });

  it("classifies anything else as inline", () => {
    expect(classifySource("Just be helpful.")).toBe("inline");
    expect(classifySource("foo bar baz")).toBe("inline");
  });

  it("rejects empty strings", () => {
    expect(() => classifySource("")).toThrow(/empty/i);
    expect(() => classifySource("   ")).toThrow(/empty/i);
  });
});
