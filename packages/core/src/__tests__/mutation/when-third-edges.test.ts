/**
 * Edge assertions found by mutation testing of when.ts: tokens that only look
 * like operators or keywords, identifiers that contain digits, errors that are
 * not expression problems, and the load-time checks on loosely declared
 * outputs and literals on the left.
 */
import { describe, expect, it } from "vitest";
import { checkExpression, evaluateExpression, parseExpression } from "../../when.js";

describe("tokens", () => {
  it("a string literal that reads like an operator is still a literal", () => {
    expect(parseExpression('"!" == a.b')).toStrictEqual({
      kind: "cmp",
      op: "==",
      left: { kind: "literal", value: "!" },
      right: { kind: "path", segments: ["a", "b"] },
    });
  });

  it("an identifier after a complete expression is not read as 'in'", () => {
    expect(() => parseExpression("a.b c.d")).toThrow("unexpected 'c' after a complete expression");
  });

  it("an identifier may contain digits, anywhere after its first character", () => {
    expect(parseExpression("node1.x2 == 3")).toStrictEqual({
      kind: "cmp",
      op: "==",
      left: { kind: "path", segments: ["node1", "x2"] },
      right: { kind: "literal", value: 3 },
    });
  });
});

describe("evaluateExpression", () => {
  it("only its own problems become a false result; anything else is thrown", () => {
    const scope = {
      a: Object.defineProperty({}, "b", {
        enumerable: true,
        get() {
          throw new Error("getter broke");
        },
      }) as Record<string, unknown>,
    };
    expect(() => evaluateExpression(parseExpression("a.b == 1"), scope)).toThrow("getter broke");
    expect(evaluateExpression(parseExpression("a.c == 1"), scope)).toStrictEqual({
      value: false,
      problem: "field 'a.c' is missing",
    });
  });
});

describe("checkExpression", () => {
  const ctx = (outputs: Record<string, unknown>) => ({
    from: "a",
    ancestors: new Set(["a"]),
    outputs: outputs as never,
  });

  it("a nested object whose properties are not an object is free-form: any field below it is accepted", () => {
    const outputs = { a: { type: "object", properties: { obj: { type: "object", properties: 5 } } } };
    expect(checkExpression("a.obj.x == 1", ctx(outputs))).toStrictEqual([]);
    expect(checkExpression('a.obj.y == "s"', ctx(outputs))).toStrictEqual([]);
  });

  it("checks a literal on the left against the declared enum on the right", () => {
    const outputs = { a: { type: "object", properties: { kind: { type: "string", enum: ["x", "y"] } } } };
    expect(checkExpression('"nope" == a.kind', ctx(outputs))).toStrictEqual([
      `'a.kind' never equals "nope"; its declared values are ["x","y"]`,
    ]);
    expect(checkExpression('"x" == a.kind', ctx(outputs))).toStrictEqual([]);
  });

  it("only string literals are checked against an enum", () => {
    const outputs = { a: { type: "object", properties: { n: { type: "number", enum: [1, 2] } } } };
    expect(checkExpression("a.n == 3", ctx(outputs))).toStrictEqual([]);
  });
});
