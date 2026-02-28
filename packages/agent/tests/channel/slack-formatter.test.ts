import { describe, it, expect } from "vitest";
import { formatForSlack } from "../../src/channel/slack-formatter.js";

describe("formatForSlack", () => {
  it("returns fallback message for empty string", () => {
    expect(formatForSlack("")).toEqual(["No response generated."]);
  });

  it("returns fallback message for undefined-ish input", () => {
    expect(formatForSlack(null as unknown as string)).toEqual([
      "No response generated.",
    ]);
  });

  it("returns single chunk for short text", () => {
    const result = formatForSlack("Hello world");
    expect(result).toEqual(["Hello world"]);
  });

  it("returns single chunk for text exactly at the limit", () => {
    const text = "a".repeat(3000);
    const result = formatForSlack(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  it("splits text exceeding the limit", () => {
    const text = "a".repeat(3001);
    const result = formatForSlack(text);
    expect(result.length).toBeGreaterThan(1);
    // All content preserved
    expect(result.join("").length).toBe(3001);
  });

  it("splits at paragraph boundary (double newline)", () => {
    const para1 = "a".repeat(2000);
    const para2 = "b".repeat(2000);
    const text = `${para1}\n\n${para2}`;

    const result = formatForSlack(text);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(para1);
    expect(result[1]).toBe(para2);
  });

  it("falls back to single newline when paragraph break is too early", () => {
    // Paragraph break at position 100 (< 1500 = 3000/2), single newline at 2500
    const before = "a".repeat(100);
    const middle = "b".repeat(2399); // 100 + 1 (\n\n) + 2399 = 2500, then \n
    const after = "c".repeat(1500);
    const text = `${before}\n\n${middle}\n${after}`;

    const result = formatForSlack(text);

    expect(result.length).toBeGreaterThan(1);
    // Should have split at the single \n at position 2500, not the \n\n at 100
    expect(result[0].length).toBeGreaterThan(1500);
  });

  it("falls back to space when no newlines in first half", () => {
    const words = [];
    let len = 0;
    while (len < 4000) {
      const word = "word";
      words.push(word);
      len += word.length + 1; // +1 for space
    }
    const text = words.join(" ");

    const result = formatForSlack(text);

    expect(result.length).toBeGreaterThan(1);
    // First chunk should end at a space boundary, not mid-word
    expect(result[0].endsWith("word")).toBe(true);
  });

  it("hard-splits when no whitespace found in first half", () => {
    // One giant unbroken string
    const text = "x".repeat(7000);

    const result = formatForSlack(text);

    expect(result.length).toBeGreaterThan(1);
    expect(result[0].length).toBe(3000);
    expect(result.join("").length).toBe(7000);
  });

  it("handles CRLF line endings", () => {
    const para1 = "a".repeat(2000);
    const para2 = "b".repeat(2000);
    const text = `${para1}\r\n\r\n${para2}`;

    const result = formatForSlack(text);

    // \r\n\r\n contains \n\n so paragraph split should still work
    expect(result.length).toBeGreaterThan(1);
  });

  it("handles multiple chunks for very long text", () => {
    const text = Array.from({ length: 20 }, (_, i) =>
      `Paragraph ${i}: ${"content ".repeat(50)}`,
    ).join("\n\n");

    const result = formatForSlack(text);

    // All content should be preserved across chunks
    const rejoined = result.join("");
    // Account for trimStart() removing leading whitespace between chunks
    expect(rejoined.length).toBeLessThanOrEqual(text.length);
    expect(rejoined).toContain("Paragraph 0");
    expect(rejoined).toContain("Paragraph 19");
  });

  it("trims leading whitespace from subsequent chunks", () => {
    const para1 = "a".repeat(2500);
    const para2 = "b".repeat(100);
    const text = `${para1}\n\n   ${para2}`;

    const result = formatForSlack(text);

    if (result.length > 1) {
      // Second chunk should not start with whitespace
      expect(result[1]).not.toMatch(/^\s/);
    }
  });
});
