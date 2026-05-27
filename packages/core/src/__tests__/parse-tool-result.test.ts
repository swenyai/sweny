import { describe, it, expect } from "vitest";
import { parseToolResultContent } from "../claude.js";

// Fix #1 hardening: parseToolResultContent is the one-way door from MCP
// tool_result.content (a string) back to typed output. These tests lock
// the contract: objects/arrays round-trip, everything else is preserved
// as-is. A silent change (e.g. starting to parse string literals) could
// corrupt tool outputs that verify then reads.

describe("parseToolResultContent", () => {
  describe("parses object and array JSON", () => {
    it("parses a JSON object", () => {
      expect(parseToolResultContent('{"x": 1, "y": "two"}')).toEqual({ x: 1, y: "two" });
    });

    it("parses a JSON array", () => {
      expect(parseToolResultContent("[1, 2, 3]")).toEqual([1, 2, 3]);
    });

    it("parses nested structures", () => {
      expect(parseToolResultContent('{"items": [{"id": 1}, {"id": 2}]}')).toEqual({
        items: [{ id: 1 }, { id: 2 }],
      });
    });

    it("tolerates leading/trailing whitespace", () => {
      expect(parseToolResultContent('  \n{"ok": true}\n  ')).toEqual({ ok: true });
    });
  });

  describe("preserves non-JSON strings verbatim", () => {
    it("plain prose", () => {
      expect(parseToolResultContent("found 3 issues")).toBe("found 3 issues");
    });

    it("http-style error body", () => {
      expect(parseToolResultContent("401 Unauthorized")).toBe("401 Unauthorized");
    });

    it("empty string", () => {
      expect(parseToolResultContent("")).toBe("");
    });

    it("whitespace-only string", () => {
      expect(parseToolResultContent("   \n  ")).toBe("   \n  ");
    });

    // Fix #1 round-2 cleanup: JSON-quoted string literals are NOT parsed.
    // We can't tell the string `"hello"` (4 wrapping quote chars + hello)
    // from a tool that actually returned the raw text starting with a
    // quote character. Safer to preserve the raw string.
    it("JSON-quoted string literal stays verbatim (safe default)", () => {
      expect(parseToolResultContent('"hello"')).toBe('"hello"');
    });

    it("JSON primitive numbers stay verbatim (ambiguous)", () => {
      expect(parseToolResultContent("42")).toBe("42");
      expect(parseToolResultContent("-3.14")).toBe("-3.14");
    });

    it("JSON primitive true/false/null stay verbatim", () => {
      expect(parseToolResultContent("true")).toBe("true");
      expect(parseToolResultContent("false")).toBe("false");
      expect(parseToolResultContent("null")).toBe("null");
    });
  });

  describe("falls back gracefully on malformed JSON", () => {
    it("unterminated object → raw string", () => {
      expect(parseToolResultContent('{"x": 1')).toBe('{"x": 1');
    });

    it("broken array → raw string", () => {
      expect(parseToolResultContent("[1, 2,,]")).toBe("[1, 2,,]");
    });

    it("mostly-JSON with trailing junk → raw string", () => {
      expect(parseToolResultContent('{"x": 1} extra')).toBe('{"x": 1} extra');
    });
  });

  describe("non-string input passes through", () => {
    it("object input is returned as-is", () => {
      const obj = { already: "parsed" };
      expect(parseToolResultContent(obj)).toBe(obj);
    });

    it("null is returned as-is", () => {
      expect(parseToolResultContent(null)).toBeNull();
    });

    it("undefined is returned as-is", () => {
      expect(parseToolResultContent(undefined)).toBeUndefined();
    });

    it("number is returned as-is", () => {
      expect(parseToolResultContent(42)).toBe(42);
    });
  });

  // Issue #215, fix #2: the Anthropic tool_result `content` field can be a
  // block array (e.g. [{type:"text",text:"..."}, ...]) instead of a string.
  // We concatenate the text blocks, then apply the same object/array JSON
  // parse. Otherwise call.output is the raw wrapper array and eval/route
  // logic walking call.output sees garbage.
  describe("unwraps tool_result block arrays", () => {
    it("parses a single text block carrying a JSON object", () => {
      expect(parseToolResultContent([{ type: "text", text: '{"a":1}' }])).toEqual({ a: 1 });
    });

    it("parses a single text block carrying a JSON array", () => {
      expect(parseToolResultContent([{ type: "text", text: "[1,2,3]" }])).toEqual([1, 2, 3]);
    });

    it("concatenates multiple text blocks before parsing", () => {
      // The model/SDK can split one JSON payload across two text blocks.
      expect(
        parseToolResultContent([
          { type: "text", text: '{"a":1,' },
          { type: "text", text: '"b":2}' },
        ]),
      ).toEqual({
        a: 1,
        b: 2,
      });
    });

    it("returns concatenated text when the blocks are not JSON", () => {
      expect(
        parseToolResultContent([
          { type: "text", text: "found " },
          { type: "text", text: "3 issues" },
        ]),
      ).toBe("found 3 issues");
    });

    it("recurses into nested block content", () => {
      expect(
        parseToolResultContent([{ type: "tool_result", content: [{ type: "text", text: '{"nested":true}' }] }]),
      ).toEqual({ nested: true });
    });

    it("ignores non-text blocks (e.g. image) and keeps the text", () => {
      expect(
        parseToolResultContent([
          { type: "image", source: { data: "..." } },
          { type: "text", text: '{"kept":1}' },
        ]),
      ).toEqual({ kept: 1 });
    });

    it("empty array returns empty string", () => {
      expect(parseToolResultContent([])).toBe("");
    });
  });
});
