/**
 * Edge assertions found by mutation testing: the exact syntax errors, the
 * strict-semantics problems and the load-time checks of when.ts. A routing
 * condition that silently evaluates the wrong way sends a run down the wrong
 * edge, so each branch is pinned with its message.
 */
import { describe, expect, it } from "vitest";
import {
  ExpressionSyntaxError,
  WHEN_EXPR_MAX_LENGTH,
  checkExpression,
  evaluateExpression,
  isWhenExpression,
  parseExpression,
  whenLabel,
} from "../../when.js";
import type { ExpressionScope } from "../../when.js";

function syntaxError(src: string): ExpressionSyntaxError {
  try {
    parseExpression(src);
  } catch (e) {
    expect(e).toBeInstanceOf(ExpressionSyntaxError);
    return e as ExpressionSyntaxError;
  }
  throw new Error(`expected a syntax error for: ${src}`);
}

const run = (src: string, scope: ExpressionScope) => evaluateExpression(parseExpression(src), scope);
const path = (...segments: string[]) => ({ kind: "path", segments });
const lit = (value: string | number | boolean | null) => ({ kind: "literal", value });

describe("edge when helpers", () => {
  it("whenLabel returns the NL text, the expression source, or undefined", () => {
    expect(whenLabel(undefined)).toBeUndefined();
    expect(whenLabel("the build passed")).toBe("the build passed");
    expect(whenLabel({ expr: "a.x == 1" })).toBe("a.x == 1");
  });

  it("isWhenExpression needs an object with a string expr", () => {
    expect(isWhenExpression({ expr: "a.x" })).toBe(true);
    expect(isWhenExpression({ expr: 1 })).toBe(false);
    expect(isWhenExpression({})).toBe(false);
    expect(isWhenExpression(null)).toBe(false);
    expect(isWhenExpression("a.x")).toBe(false);
    expect(isWhenExpression([{ expr: "a.x" }])).toBe(false);
  });
});

describe("parseExpression: tokenizer", () => {
  it("carries the position on the error and names the class", () => {
    const e = syntaxError("a.x = 1");
    expect(e.name).toBe("ExpressionSyntaxError");
    expect(e.position).toBe(4);
  });

  it("accepts spaces, tabs, newlines and carriage returns between tokens", () => {
    expect(parseExpression("a.x\t==\n1\r\n&&\ta.y")).toMatchObject({ kind: "and" });
  });

  it("suggests the doubled operator for a lone =, & or |", () => {
    expect(syntaxError("a.x = 1").message).toBe("unexpected '='; did you mean '=='? (at position 4)");
    expect(syntaxError("a.x & b.y").message).toBe("unexpected '&'; did you mean '&&'? (at position 4)");
    expect(syntaxError("a.x | b.y").message).toBe("unexpected '|'; did you mean '||'? (at position 4)");
  });

  it("rejects an empty or blank source, and a non-string", () => {
    expect(syntaxError("").message).toBe("empty expression (at position 0)");
    expect(syntaxError("  \t ").message).toBe("empty expression (at position 0)");
    expect(() => parseExpression(undefined as unknown as string)).toThrow("empty expression");
  });

  it("caps the source length at exactly the limit", () => {
    const atLimit = `a.x == '${"y".repeat(WHEN_EXPR_MAX_LENGTH - 9)}'`;
    expect(atLimit).toHaveLength(WHEN_EXPR_MAX_LENGTH);
    expect(parseExpression(atLimit).kind).toBe("cmp");
    expect(syntaxError(`${atLimit} `).message).toBe(
      `expression longer than ${WHEN_EXPR_MAX_LENGTH} characters (at position 0)`,
    );
  });

  it("decodes string escapes", () => {
    const right = (src: string) => (parseExpression(src) as unknown as { right: unknown }).right;
    expect(right(String.raw`a.x == 'it\'s'`)).toStrictEqual(lit("it's"));
    expect(right(String.raw`a.x == "say \"hi\""`)).toStrictEqual(lit('say "hi"'));
    expect(right(String.raw`a.x == 'a\\b'`)).toStrictEqual(lit("a\\b"));
    expect(right(String.raw`a.x == 'a\nb'`)).toStrictEqual(lit("a\nb"));
    expect(right(String.raw`a.x == 'a\tb'`)).toStrictEqual(lit("a\tb"));
    expect(right(`a.x == "a'b"`)).toStrictEqual(lit("a'b"));
  });

  it("rejects an unknown escape and an unterminated string", () => {
    expect(syntaxError(String.raw`'a\q'`).message).toBe("unknown escape '\\q' (at position 2)");
    expect(syntaxError("'a\\").message).toBe("unknown escape '\\' (at position 2)");
    expect(syntaxError("a.x == 'abc").message).toBe("unterminated string (at position 7)");
    expect(syntaxError(`a.x == "abc'`).message).toBe("unterminated string (at position 7)");
  });

  it("parses integers, decimals and negatives", () => {
    const right = (src: string) => (parseExpression(src) as unknown as { right: unknown }).right;
    expect(right("a.x == 12")).toStrictEqual(lit(12));
    expect(right("a.x == -5")).toStrictEqual(lit(-5));
    expect(right("a.x == 3.25")).toStrictEqual(lit(3.25));
    expect(right("a.x == -0.5")).toStrictEqual(lit(-0.5));
  });

  it("rejects malformed numbers and a stray minus", () => {
    expect(syntaxError("a.x == 1a").message).toBe("malformed number '1a' (at position 7)");
    expect(syntaxError("a.x == -1a").message).toBe("malformed number '-1a' (at position 7)");
    expect(syntaxError("a.x == -").message).toBe("unexpected character '-' (at position 7)");
    expect(syntaxError("a.x == #").message).toBe("unexpected character '#' (at position 7)");
  });

  it("a trailing dot after a number is not a decimal", () => {
    expect(syntaxError("a.x == 1.").message).toBe("unexpected '.' after a complete expression (at position 8)");
  });

  it("identifiers may contain digits, underscores and hyphens", () => {
    expect(parseExpression("my-node_2.field_1")).toStrictEqual(path("my-node_2", "field_1"));
  });
});

describe("parseExpression: grammar", () => {
  it("builds each comparison operator", () => {
    for (const op of ["==", "!=", "<", "<=", ">", ">="]) {
      expect(parseExpression(`a.x ${op} 1`)).toStrictEqual({
        kind: "cmp",
        op,
        left: path("a", "x"),
        right: lit(1),
      });
    }
    expect(parseExpression("a.x in [1]")).toStrictEqual({
      kind: "cmp",
      op: "in",
      left: path("a", "x"),
      right: { kind: "list", items: [1] },
    });
  });

  it("&& binds tighter than ||, and ! tighter than both", () => {
    expect(parseExpression("a.x || b.y && c.z")).toMatchObject({
      kind: "or",
      left: path("a", "x"),
      right: { kind: "and", left: path("b", "y"), right: path("c", "z") },
    });
    expect(parseExpression("!a.x && b.y")).toMatchObject({
      kind: "and",
      left: { kind: "not", operand: path("a", "x") },
    });
  });

  it("parses lists, exists and parentheses", () => {
    expect(parseExpression("a.x in []")).toMatchObject({ right: { kind: "list", items: [] } });
    expect(parseExpression("a.x in [1, 'b', true, false, null]")).toMatchObject({
      right: { items: [1, "b", true, false, null] },
    });
    expect(parseExpression("exists a.x")).toStrictEqual({ kind: "exists", path: path("a", "x") });
    expect(parseExpression("(a.x || b.y) && c.z")).toMatchObject({ kind: "and", left: { kind: "or" } });
    expect(parseExpression("true")).toStrictEqual(lit(true));
    expect(parseExpression("null")).toStrictEqual(lit(null));
  });

  it("describes the offending token in each error", () => {
    expect(syntaxError("a.x ==").message).toBe("unexpected end of expression (at position 6)");
    expect(syntaxError("exists 'abc'").message).toBe("expected a field path but found string 'abc' (at position 7)");
    expect(syntaxError("exists 5").message).toBe("expected a field path but found '5' (at position 7)");
    expect(syntaxError("exists (").message).toBe("expected a field path but found '(' (at position 7)");
    expect(syntaxError("exists true").message).toBe("expected a field path but found 'true' (at position 7)");
    expect(syntaxError("a.").message).toBe(
      "expected a field name after '.' but found end of expression (at position 2)",
    );
    expect(syntaxError("a.1").message).toBe("expected a field name after '.' but found '1' (at position 2)");
    expect(syntaxError("a.'s'").message).toBe("expected a field name after '.' but found string 's' (at position 2)");
    expect(syntaxError("(a.x").message).toBe("expected ')' but found end of expression (at position 4)");
    expect(syntaxError("a.x in [1").message).toBe("expected ']' but found end of expression (at position 9)");
  });

  it("rejects a bare identifier and tells the author to quote it", () => {
    expect(syntaxError("exists a").message).toBe(
      "path 'a' needs a node and a field (e.g. 'a.field'); quote it if you meant a string (at position 7)",
    );
    expect(syntaxError("a == 1").message).toContain("path 'a' needs a node and a field");
  });

  it("rejects misplaced tokens", () => {
    expect(syntaxError("in == 1").message).toBe("unexpected 'in' (at position 0)");
    expect(syntaxError(") ").message).toBe("unexpected ')' (at position 0)");
    expect(syntaxError("a.x == 1 2").message).toBe("unexpected '2' after a complete expression (at position 9)");
    expect(syntaxError("a.x in [b.y]").message).toBe("expected a literal but found 'b' (at position 8)");
    expect(syntaxError("a.x in [1,]").message).toBe("expected a literal but found ']' (at position 10)");
  });

  it("caps nesting at 64 levels for parens and for !", () => {
    const parens = (n: number) => `${"(".repeat(n)}a.x${")".repeat(n)}`;
    expect(parseExpression(parens(63))).toStrictEqual(path("a", "x"));
    expect(syntaxError(parens(64)).message).toMatch(/^nesting deeper than 64 \(at position 64\)/);
    expect(parseExpression(`${"!".repeat(63)}a.x`).kind).toBe("not");
    expect(syntaxError(`${"!".repeat(64)}a.x`).message).toMatch(/^nesting deeper than 64/);
  });

  it("nesting depth is released after each group, so long flat expressions parse", () => {
    const flatParens = Array.from({ length: 100 }, () => "(a.x == 1)").join(" && ");
    expect(parseExpression(flatParens).kind).toBe("and");
    const flatNots = Array.from({ length: 100 }, () => "!a.x").join(" && ");
    expect(parseExpression(flatNots).kind).toBe("and");
    const flatOrs = Array.from({ length: 100 }, () => "(a.x || b.y)").join(" && ");
    expect(parseExpression(flatOrs).kind).toBe("and");
  });
});

describe("evaluateExpression", () => {
  it("reports a missing field and does not throw on a missing node", () => {
    expect(run("a.x == 1", {})).toStrictEqual({ value: false, problem: "field 'a.x' is missing" });
    expect(run("a.x == 1", { a: undefined })).toStrictEqual({ value: false, problem: "field 'a.x' is missing" });
    expect(run("a.x.y == 1", { a: { x: {} } })).toStrictEqual({ value: false, problem: "field 'a.x.y' is missing" });
  });

  it("only reads own properties and never walks through null, arrays or scalars", () => {
    expect(run("a.toString == 1", { a: {} }).problem).toBe("field 'a.toString' is missing");
    expect(run("constructor.name == 'x'", {}).problem).toBe("field 'constructor.name' is missing");
    expect(run("a.x.y == 1", { a: { x: null } }).problem).toBe("field 'a.x.y' is missing");
    expect(run("a.x.length == 1", { a: { x: [1] } }).problem).toBe("field 'a.x.length' is missing");
    expect(run("a.x.length == 1", { a: { x: "abc" } }).problem).toBe("field 'a.x.length' is missing");
    expect(run("a.b.c == 1", { a: { b: { c: 1 } } })).toStrictEqual({ value: true });
  });

  it("exists is true for present non-null values, never a problem", () => {
    expect(run("exists a.x", { a: { x: 0 } })).toStrictEqual({ value: true });
    expect(run("exists a.x", { a: { x: "" } })).toStrictEqual({ value: true });
    expect(run("exists a.x", { a: { x: null } })).toStrictEqual({ value: false });
    expect(run("exists a.x", { a: {} })).toStrictEqual({ value: false });
    expect(run("exists a.x", {})).toStrictEqual({ value: false });
  });

  it("&&, || and ! need booleans and name the operator", () => {
    expect(run("a.x && b.y", { a: { x: 1 }, b: { y: true } }).problem).toBe("'&&' needs a boolean, got number");
    expect(run("a.x && b.y", { a: { x: true }, b: { y: "s" } }).problem).toBe("'&&' needs a boolean, got string");
    expect(run("a.x || b.y", { a: { x: "s" }, b: { y: true } }).problem).toBe("'||' needs a boolean, got string");
    expect(run("a.x || b.y", { a: { x: false }, b: { y: null } }).problem).toBe("'||' needs a boolean, got null");
    expect(run("!a.x", { a: { x: [] } }).problem).toBe("'!' needs a boolean, got list");
    expect(run("!a.x", { a: { x: false } })).toStrictEqual({ value: true });
    expect(run("!a.x", { a: { x: true } })).toStrictEqual({ value: false });
  });

  it("short-circuits so a guarded missing field is safe", () => {
    expect(run("a.x && b.y", { a: { x: false } })).toStrictEqual({ value: false });
    expect(run("a.x || b.y", { a: { x: true } })).toStrictEqual({ value: true });
    expect(run("a.x || b.y", { a: { x: false }, b: { y: true } })).toStrictEqual({ value: true });
    expect(run("a.x && b.y", { a: { x: true }, b: { y: false } })).toStrictEqual({ value: false });
    expect(run("exists a.x && a.x > 0", { a: {} })).toStrictEqual({ value: false });
    expect(run("exists a.x && a.x > 0", { a: { x: 2 } })).toStrictEqual({ value: true });
  });

  it("== and != compare primitives strictly, with no coercion", () => {
    expect(run("a.x == 1", { a: { x: 1 } })).toStrictEqual({ value: true });
    expect(run("a.x == 1", { a: { x: "1" } })).toStrictEqual({ value: false });
    expect(run("a.x != 1", { a: { x: "1" } })).toStrictEqual({ value: true });
    expect(run("a.x != 1", { a: { x: 1 } })).toStrictEqual({ value: false });
    expect(run("a.x == null", { a: { x: null } })).toStrictEqual({ value: true });
    expect(run("a.x == true", { a: { x: true } })).toStrictEqual({ value: true });
  });

  it("== and != refuse non-primitives", () => {
    expect(run("a.x == b.y", { a: { x: [1] }, b: { y: 1 } }).problem).toBe(
      "'==' compares strings, numbers, booleans or null, got list and number",
    );
    expect(run("a.x != b.y", { a: { x: 1 }, b: { y: {} } }).problem).toBe(
      "'!=' compares strings, numbers, booleans or null, got number and object",
    );
  });

  it("orders numbers and strings with the right boundary", () => {
    const num = (op: string, a: number, b: number) => run(`a.x ${op} b.y`, { a: { x: a }, b: { y: b } }).value;
    expect([num("<", 2, 2), num("<", 1, 2), num("<", 3, 2)]).toStrictEqual([false, true, false]);
    expect([num("<=", 2, 2), num("<=", 1, 2), num("<=", 3, 2)]).toStrictEqual([true, true, false]);
    expect([num(">", 2, 2), num(">", 3, 2), num(">", 1, 2)]).toStrictEqual([false, true, false]);
    expect([num(">=", 2, 2), num(">=", 3, 2), num(">=", 1, 2)]).toStrictEqual([true, true, false]);
    expect(run("a.x < b.y", { a: { x: "apple" }, b: { y: "banana" } })).toStrictEqual({ value: true });
    expect(run("a.x >= b.y", { a: { x: "apple" }, b: { y: "banana" } })).toStrictEqual({ value: false });
  });

  it("ordering needs two numbers or two strings", () => {
    expect(run("a.x < b.y", { a: { x: 1 }, b: { y: "2" } }).problem).toBe(
      "'<' needs two numbers or two strings, got number and string",
    );
    expect(run("a.x >= b.y", { a: { x: "1" }, b: { y: 2 } }).problem).toBe(
      "'>=' needs two numbers or two strings, got string and number",
    );
    expect(run("a.x > b.y", { a: { x: true }, b: { y: false } }).problem).toBe(
      "'>' needs two numbers or two strings, got boolean and boolean",
    );
    expect(run("a.x <= b.y", { a: { x: null }, b: { y: 1 } }).problem).toBe(
      "'<=' needs two numbers or two strings, got null and number",
    );
  });

  it("in needs a list on the right and a primitive on the left", () => {
    expect(run("a.x in [1, 2]", { a: { x: 2 } })).toStrictEqual({ value: true });
    expect(run("a.x in [1, 2]", { a: { x: 3 } })).toStrictEqual({ value: false });
    expect(run("a.x in [1, 2]", { a: { x: "2" } })).toStrictEqual({ value: false });
    expect(run("a.x in [null]", { a: { x: null } })).toStrictEqual({ value: true });
    expect(run("a.x in b.y", { a: { x: 1 }, b: { y: "s" } }).problem).toBe(
      "'in' needs a list on the right, got string",
    );
    expect(run("a.x in [1]", { a: { x: [1] } }).problem).toBe(
      "'in' needs a string, number, boolean or null on the left",
    );
  });

  it("a non-boolean result is a problem that names its type", () => {
    expect(run("a.x", { a: { x: 5 } })).toStrictEqual({
      value: false,
      problem: "expression produced number, not a boolean",
    });
    expect(run("'s'", {}).problem).toBe("expression produced string, not a boolean");
    expect(run("null", {}).problem).toBe("expression produced null, not a boolean");
    expect(run("[1]", {}).problem).toBe("expression produced list, not a boolean");
    expect(run("a.x", { a: { x: {} } }).problem).toBe("expression produced object, not a boolean");
    expect(run("a.x", { a: { x: true } })).toStrictEqual({ value: true });
  });
});

describe("checkExpression", () => {
  const outputs: Record<string, Record<string, unknown> | undefined> = {
    a: {
      type: "object",
      properties: {
        s: { type: "string", enum: ["ok", "bad"] },
        i: { type: "integer" },
        num: { type: "number" },
        flag: { type: "boolean" },
        tags: { type: "array" },
        free: { type: "object" },
        nested: { type: "object", properties: { deep: { type: "string" } } },
        opt: { type: ["string", "null"] },
        untyped: {},
      },
    },
    b: { properties: { ok: { type: "boolean" } } },
    z: { properties: { f: { type: "string" } } },
    empty: { type: "object", properties: {} },
    weird: { properties: "nope" },
    bare: undefined,
  };
  const ctx = {
    from: "c",
    ancestors: new Set(["a", "b", "empty", "weird", "bare"]),
    outputs: outputs as Record<string, never>,
  };
  const check = (src: string) => checkExpression(src, ctx);

  it("returns the syntax error message for an unparsable source", () => {
    expect(check("a.s =")).toStrictEqual(["unexpected '='; did you mean '=='? (at position 4)"]);
  });

  it("accepts a well-formed expression", () => {
    expect(check("a.s == 'ok' && a.i > 1 && a.flag && exists a.opt")).toStrictEqual([]);
  });

  it("flags unknown nodes, non-ancestors, and nodes without declared output properties", () => {
    expect(check("q.x == 1")).toStrictEqual(["'q.x': no node named 'q'"]);
    expect(check("z.f == 'a'")).toStrictEqual(["'z.f': node 'z' does not run before 'c' on any path"]);
    expect(check("empty.f == 1")).toStrictEqual([
      "'empty.f': node 'empty' declares no output.properties, so it has no fields to route on",
    ]);
    expect(check("weird.f == 1")).toStrictEqual([
      "'weird.f': node 'weird' declares no output.properties, so it has no fields to route on",
    ]);
    expect(check("bare.f == 1")).toStrictEqual([
      "'bare.f': node 'bare' declares no output.properties, so it has no fields to route on",
    ]);
  });

  it("flags an undeclared field at any depth", () => {
    expect(check("a.nope == 1")).toStrictEqual(["'a.nope': 'nope' is not a declared output field of 'a'"]);
    expect(check("a.nested.zzz == 1")).toStrictEqual([
      "'a.nested.zzz': 'zzz' is not a declared output field of 'a.nested'",
    ]);
    expect(check("a.nested.deep == 'x'")).toStrictEqual([]);
  });

  it("refuses to index lists and scalars, but accepts a free-form object", () => {
    expect(check("a.tags.first == 1")).toStrictEqual([
      "'a.tags.first': 'a.tags' is a list; expressions cannot index lists",
    ]);
    expect(check("a.s.len == 1")).toStrictEqual(["'a.s.len': 'a.s' is a string, not an object"]);
    expect(check("a.i.x == 1")).toStrictEqual(["'a.i.x': 'a.i' is a integer, not an object"]);
    expect(check("a.num.x == 1")).toStrictEqual(["'a.num.x': 'a.num' is a number, not an object"]);
    expect(check("a.flag.x == 1")).toStrictEqual(["'a.flag.x': 'a.flag' is a boolean, not an object"]);
    expect(check("a.free.anything == 1")).toStrictEqual([]);
    expect(check("a.free.anything && a.flag")).toStrictEqual([]);
    expect(check("a.free.anything == 'q'")).toStrictEqual([]);
  });

  it("checks exists and every operand of !, && and || for resolvable paths", () => {
    expect(check("exists q.x")).toStrictEqual(["'q.x': no node named 'q'"]);
    expect(check("exists a.nope")).toStrictEqual(["'a.nope': 'nope' is not a declared output field of 'a'"]);
    expect(check("!q.x")).toStrictEqual(["'q.x': no node named 'q'"]);
    expect(check("a.flag || q.x")).toStrictEqual(["'q.x': no node named 'q'"]);
    expect(check("q.x && a.flag")).toStrictEqual(["'q.x': no node named 'q'"]);
    expect(check("a.flag && (r.y == 1)")).toStrictEqual(["'r.y': no node named 'r'"]);
  });

  it("a literal must fit the declared type", () => {
    expect(check("a.i == 'x'")).toStrictEqual([`'a.i' is declared integer but is compared with "x"`]);
    expect(check("a.i == 1.5")).toStrictEqual(["'a.i' is declared integer but is compared with 1.5"]);
    expect(check("a.i == 2")).toStrictEqual([]);
    expect(check("a.num == 1.5")).toStrictEqual([]);
    expect(check("a.s == 5")).toStrictEqual(["'a.s' is declared string but is compared with 5"]);
    expect(check("a.flag == 'yes'")).toStrictEqual([`'a.flag' is declared boolean but is compared with "yes"`]);
    expect(check("a.flag == true")).toStrictEqual([]);
    expect(check("'x' == a.i")).toStrictEqual([`'a.i' is declared integer but is compared with "x"`]);
    expect(check("a.opt == 5")).toStrictEqual(["'a.opt' is declared string|null but is compared with 5"]);
    expect(check("a.opt == 'x'")).toStrictEqual([]);
    expect(check("a.untyped == 5")).toStrictEqual([]);
  });

  it("== null is always allowed", () => {
    expect(check("a.i == null")).toStrictEqual([]);
    expect(check("a.i != null")).toStrictEqual([]);
    expect(check("null == a.i")).toStrictEqual([]);
  });

  it("a string compared with an enum must be one of its values", () => {
    expect(check("a.s == 'nope'")).toStrictEqual([`'a.s' never equals "nope"; its declared values are ["ok","bad"]`]);
    expect(check("a.s != 'nope'")).toStrictEqual([`'a.s' never equals "nope"; its declared values are ["ok","bad"]`]);
    expect(check("a.s == 'bad'")).toStrictEqual([]);
    expect(check("a.s in ['ok', 'zzz']")).toStrictEqual([
      `'a.s' never equals "zzz"; its declared values are ["ok","bad"]`,
    ]);
    expect(check("a.i in [1, 'q']")).toStrictEqual([`'a.i' is declared integer but is compared with "q"`]);
  });

  it("comparisons between two paths, or in with a path on either side, are not literal-checked", () => {
    expect(check("a.i == b.ok")).toStrictEqual([]);
    expect(check("a.s in b.ok")).toStrictEqual([]);
    expect(check("[1] in a.s")).toStrictEqual([]);
    expect(check("a.i < 3")).toStrictEqual([]);
  });

  it("a field used as a boolean must be declared boolean", () => {
    expect(check("a.s && a.flag")).toStrictEqual(["'a.s' is declared string; use a comparison, it is not a boolean"]);
    expect(check("a.flag || a.i")).toStrictEqual(["'a.i' is declared integer; use a comparison, it is not a boolean"]);
    expect(check("!a.i")).toStrictEqual(["'a.i' is declared integer; use a comparison, it is not a boolean"]);
    expect(check("a.s")).toStrictEqual(["'a.s' is declared string; use a comparison, it is not a boolean"]);
    expect(check("a.opt && a.flag")).toStrictEqual([
      "'a.opt' is declared string|null; use a comparison, it is not a boolean",
    ]);
    expect(check("a.flag && a.untyped")).toStrictEqual([]);
    expect(check("a.flag && b.ok")).toStrictEqual([]);
    expect(check("!a.flag")).toStrictEqual([]);
  });

  it("literals and lists used as booleans are flagged", () => {
    expect(check("5 && a.flag")).toStrictEqual(["5 is not a boolean"]);
    expect(check("'s' || a.flag")).toStrictEqual([`"s" is not a boolean`]);
    expect(check("null && a.flag")).toStrictEqual(["null is not a boolean"]);
    expect(check("[1] && a.flag")).toStrictEqual(["a list is not a boolean"]);
    expect(check("5")).toStrictEqual(["5 is not a boolean"]);
    expect(check("true && a.flag")).toStrictEqual([]);
    expect(check("!(a.i == 'x')")).toStrictEqual([`'a.i' is declared integer but is compared with "x"`]);
    expect(check("(a.i == 'x') || a.flag")).toStrictEqual([`'a.i' is declared integer but is compared with "x"`]);
    expect(check("a.flag && (a.i == 'x')")).toStrictEqual([`'a.i' is declared integer but is compared with "x"`]);
  });
});

describe("checkExpression and parser: second-pass edges", () => {
  const nodeOut = {
    a: { type: "object", properties: { i: { type: "integer" }, flag: { type: "boolean" } } },
    m: { properties: { t: { type: ["string", 5] } } },
  };
  const ctx = {
    from: "c",
    ancestors: new Set(["a", "m"]),
    outputs: nodeOut as unknown as Record<string, never>,
  };

  it("every keyword is refused where a field path is expected", () => {
    for (const kw of ["in", "exists", "null", "false", "true"]) {
      expect(syntaxError(`exists ${kw}`).message).toBe(`expected a field path but found '${kw}' (at position 7)`);
    }
  });

  it("a string that spells an operator or keyword is still a string", () => {
    expect(syntaxError("a.x 'in' [1]").message).toBe(
      "unexpected string 'in' after a complete expression (at position 4)",
    );
    expect(syntaxError("a.x '==' 1").message).toBe(
      "unexpected string '==' after a complete expression (at position 4)",
    );
  });

  it("reports only path problems when a path is wrong, not the boolean-position ones too", () => {
    expect(checkExpression("q.x && 5", ctx)).toStrictEqual(["'q.x': no node named 'q'"]);
  });

  it("ignores non-string entries in a declared type list", () => {
    expect(checkExpression("m.t == 7", ctx)).toStrictEqual(["'m.t' is declared string but is compared with 7"]);
  });

  it("checks both sides of a comparison that holds a parenthesized comparison", () => {
    const bad = `'a.i' is declared integer but is compared with "x"`;
    expect(checkExpression("(a.i == 'x') == true", ctx)).toStrictEqual([bad]);
    expect(checkExpression("true == (a.i == 'x')", ctx)).toStrictEqual([bad]);
    expect(checkExpression("(a.i == 1) == (a.flag == true)", ctx)).toStrictEqual([]);
  });
});
