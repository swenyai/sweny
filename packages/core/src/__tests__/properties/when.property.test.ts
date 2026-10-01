// Property-based and adversarial tests for the `when` expression language
// (when.ts): the parser is total up to a typed syntax error, evaluation never
// throws, a missing field can never make an expression true, and nesting and
// length are bounded.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  ExpressionSyntaxError,
  WHEN_EXPR_MAX_LENGTH,
  checkExpression,
  evaluateExpression,
  parseExpression,
  type CmpOp,
  type ExprNode,
  type ExpressionScope,
  type Literal,
} from "../../when.js";
import { params } from "./config.js";

// ─── Helpers ─────────────────────────────────────────────────────

/** Parse; the only acceptable failure is the typed syntax error. */
function parseTyped(src: string): ExprNode | ExpressionSyntaxError {
  try {
    return parseExpression(src);
  } catch (err) {
    if (err instanceof ExpressionSyntaxError) return err;
    throw new Error(`parseExpression threw a non-syntax error for ${JSON.stringify(src.slice(0, 80))}: ${String(err)}`);
  }
}

const CMP_OPS: CmpOp[] = ["==", "!=", "<", "<=", ">", ">=", "in"];

// ─── Generators ──────────────────────────────────────────────────

const TOKENS = [
  "&&",
  "||",
  "!",
  "(",
  ")",
  "[",
  "]",
  ",",
  ".",
  "==",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "in",
  "exists",
  "true",
  "false",
  "null",
  "a.b",
  "x.y.z",
  "n1.flag",
  "'s'",
  '"t"',
  "1",
  "-2",
  "3.5",
  "'unterminated",
  "\\",
  "=",
  "&",
  "|",
  "\\q",
  "1e5",
  "09x",
  "$",
  "#",
];

/** Token soup: reaches deep parser states far more often than random strings. */
const soupArb = fc
  .tuple(fc.array(fc.constantFrom(...TOKENS), { maxLength: 40 }), fc.constantFrom(" ", "", "\n", "\t"))
  .map(([toks, sep]) => toks.join(sep));

const anySourceArb = fc.oneof(
  fc.string({ maxLength: 200 }),
  fc.fullUnicodeString({ maxLength: 100 }),
  soupArb,
  soupArb,
  fc.string({ minLength: WHEN_EXPR_MAX_LENGTH - 50, maxLength: WHEN_EXPR_MAX_LENGTH + 100 }),
);

/** Arbitrary JSON the routed data could hold. */
const wideScopeArb: fc.Arbitrary<ExpressionScope> = fc.dictionary(
  fc.constantFrom("a", "b", "x", "n1", "step-1"),
  fc.dictionary(
    fc.oneof(fc.constantFrom("b", "y", "z", "flag", "in", "__proto__"), fc.string({ maxLength: 3 })),
    fc.jsonValue({ maxDepth: 2 }),
  ),
  { maxKeys: 4 },
) as fc.Arbitrary<ExpressionScope>;

// Small pools so that generated paths hit the generated scope often.
const PATHS: string[][] = [
  ["a", "b"],
  ["a", "c"],
  ["a", "d"],
  ["a", "d", "e"],
  ["a", "flag"],
  ["n1", "flag"],
  ["n1", "b"],
  ["a", "zz"],
  ["ghost", "x"],
  ["a", "b", "e"],
];
const MISSING_PATHS: string[][] = [
  ["a", "zz"],
  ["a", "yy"],
  ["ghost", "x"],
  ["n1", "nope"],
  ["a", "zz", "deeper"],
];

const pathNode = (segments: string[]): ExprNode => ({ kind: "path", segments });

const smallValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer({ min: -3, max: 3 }),
  fc.constantFrom("a", "b", "high", ""),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.integer({ min: 0, max: 2 }), { maxLength: 2 }),
  fc.dictionary(fc.constantFrom("e", "f"), fc.integer({ min: 0, max: 2 }), { maxKeys: 2 }),
);

const evalScopeArb: fc.Arbitrary<ExpressionScope> = fc.record(
  {
    a: fc.dictionary(fc.constantFrom("b", "c", "d", "flag"), smallValueArb, { maxKeys: 4 }),
    n1: fc.dictionary(fc.constantFrom("b", "c", "flag"), smallValueArb, { maxKeys: 3 }),
  },
  { requiredKeys: [] },
) as fc.Arbitrary<ExpressionScope>;

const smallLiteralArb: fc.Arbitrary<Literal> = fc.oneof(
  fc.integer({ min: -3, max: 3 }),
  fc.constantFrom("a", "b", "high", ""),
  fc.boolean(),
  fc.constant(null),
);

const evalLeafArb: fc.Arbitrary<ExprNode> = fc.oneof(
  smallLiteralArb.map((value): ExprNode => ({ kind: "literal", value })),
  fc.array(smallLiteralArb, { maxLength: 3 }).map((items): ExprNode => ({ kind: "list", items })),
  fc.constantFrom(...PATHS).map(pathNode),
  fc.constantFrom(...PATHS).map((segments): ExprNode => ({ kind: "exists", path: { kind: "path", segments } })),
);

/** Build a recursive expression arbitrary over a leaf arbitrary. */
function exprArb(leaf: fc.Arbitrary<ExprNode>, depth: number): fc.Arbitrary<ExprNode> {
  const memo = fc.memo<ExprNode>((n) => {
    if (n <= 1) return leaf;
    const sub = memo(n - 1);
    return fc.oneof(
      leaf,
      sub.map((operand): ExprNode => ({ kind: "not", operand })),
      fc
        .tuple(fc.constantFrom<"and" | "or">("and", "or"), sub, sub)
        .map(([kind, left, right]): ExprNode => ({ kind, left, right })),
      fc
        .tuple(fc.constantFrom(...CMP_OPS), sub, sub)
        .map(([op, left, right]): ExprNode => ({ kind: "cmp", op, left, right })),
    );
  });
  return memo(depth);
}

// ─── Reference semantics (independent of when.ts) ────────────────
//
// Written from the module's documented rules: no coercion, no truthiness,
// strict booleans for && || !, numbers-or-strings for ordering, a missing
// field aborts the WHOLE expression to false, `exists` is the one presence
// test, && and || short-circuit.

class Abort extends Error {}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function own(o: Record<string, unknown>, k: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
}

function refRead(scope: ExpressionScope, segs: string[]): unknown {
  let cur: unknown = own(scope as Record<string, unknown>, segs[0]);
  for (const s of segs.slice(1)) {
    if (!isPlainObject(cur)) return undefined;
    cur = own(cur, s);
  }
  return cur;
}

const isPrim = (v: unknown): boolean => v === null || ["string", "number", "boolean"].includes(typeof v);

function refEval(n: ExprNode, scope: ExpressionScope): unknown {
  const asBool = (v: unknown): boolean => {
    if (typeof v !== "boolean") throw new Abort("not a boolean");
    return v;
  };
  switch (n.kind) {
    case "literal":
      return n.value;
    case "list":
      return n.items;
    case "path": {
      const v = refRead(scope, n.segments);
      if (v === undefined) throw new Abort("missing");
      return v;
    }
    case "exists": {
      const v = refRead(scope, n.path.segments);
      return v !== undefined && v !== null;
    }
    case "not":
      return !asBool(refEval(n.operand, scope));
    case "and":
      return asBool(refEval(n.left, scope)) ? asBool(refEval(n.right, scope)) : false;
    case "or":
      return asBool(refEval(n.left, scope)) ? true : asBool(refEval(n.right, scope));
    case "cmp": {
      const l = refEval(n.left, scope);
      const r = refEval(n.right, scope);
      if (n.op === "in") {
        if (!Array.isArray(r) || !isPrim(l)) throw new Abort("in");
        return r.includes(l);
      }
      if (n.op === "==" || n.op === "!=") {
        if (!isPrim(l) || !isPrim(r)) throw new Abort("eq");
        return n.op === "==" ? l === r : l !== r;
      }
      const ok = (typeof l === "number" && typeof r === "number") || (typeof l === "string" && typeof r === "string");
      if (!ok) throw new Abort("order");
      const a = l as number | string;
      const b = r as number | string;
      return n.op === "<" ? a < b : n.op === "<=" ? a <= b : n.op === ">" ? a > b : a >= b;
    }
  }
}

function reference(n: ExprNode, scope: ExpressionScope): { value: boolean; problem: boolean } {
  try {
    const v = refEval(n, scope);
    return typeof v === "boolean" ? { value: v, problem: false } : { value: false, problem: true };
  } catch (err) {
    if (err instanceof Abort) return { value: false, problem: true };
    throw err;
  }
}

// ─── Rendering (for round trips) ─────────────────────────────────

const escapeStr = (s: string): string =>
  s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t");

function renderLiteral(v: Literal): string {
  if (typeof v === "string") return `"${escapeStr(v)}"`;
  return String(v);
}

const isAtom = (n: ExprNode): boolean =>
  n.kind === "literal" || n.kind === "list" || n.kind === "path" || n.kind === "exists";

function render(n: ExprNode): string {
  const child = (c: ExprNode): string => (isAtom(c) ? render(c) : `(${render(c)})`);
  switch (n.kind) {
    case "literal":
      return renderLiteral(n.value);
    case "list":
      return `[${n.items.map(renderLiteral).join(", ")}]`;
    case "path":
      return n.segments.join(".");
    case "exists":
      return `exists ${n.path.segments.join(".")}`;
    case "not":
      return `!${child(n.operand)}`;
    case "and":
      return `${child(n.left)} && ${child(n.right)}`;
    case "or":
      return `${child(n.left)} || ${child(n.right)}`;
    case "cmp":
      return `${child(n.left)} ${n.op} ${child(n.right)}`;
  }
}

const FIRST_SEGMENTS = ["a", "b", "node-1", "triage", "x_y", "severity", "N2", "inx", "existsx", "truex"];
const REST_SEGMENTS = [...FIRST_SEGMENTS, "in", "exists", "true", "false", "null"];

const wideStringArb = fc.oneof(
  fc.fullUnicodeString({ maxLength: 8 }),
  fc.stringOf(fc.constantFrom("a", "'", '"', "\\", "\n", "\t", " ", "é", "\u{1F600}", "&&", "(", ")"), {
    maxLength: 8,
  }),
);

const wideLiteralArb: fc.Arbitrary<Literal> = fc.oneof(
  fc.integer({ min: -100000, max: 100000 }),
  fc.integer({ min: -100000, max: 100000 }).map((n) => n / 100),
  wideStringArb,
  fc.boolean(),
  fc.constant(null),
);

const widePathArb: fc.Arbitrary<string[]> = fc
  .tuple(
    fc.constantFrom(...FIRST_SEGMENTS),
    fc.array(fc.constantFrom(...REST_SEGMENTS), { minLength: 1, maxLength: 3 }),
  )
  .map(([first, rest]) => [first, ...rest]);

const wideLeafArb: fc.Arbitrary<ExprNode> = fc.oneof(
  wideLiteralArb.map((value): ExprNode => ({ kind: "literal", value })),
  fc.array(wideLiteralArb, { maxLength: 4 }).map((items): ExprNode => ({ kind: "list", items })),
  widePathArb.map(pathNode),
  widePathArb.map((segments): ExprNode => ({ kind: "exists", path: { kind: "path", segments } })),
);

// ─── Properties ──────────────────────────────────────────────────

describe("when: parser is total up to a typed syntax error", () => {
  it("never throws anything but ExpressionSyntaxError, on any string", () => {
    fc.assert(
      fc.property(anySourceArb, (src) => {
        const r = parseTyped(src);
        if (r instanceof ExpressionSyntaxError) {
          expect(Number.isInteger(r.position)).toBe(true);
          expect(r.position).toBeGreaterThanOrEqual(0);
        }
      }),
      params(300),
    );
  });

  it("evaluation is total: whatever parses evaluates over arbitrary JSON without throwing", () => {
    fc.assert(
      fc.property(anySourceArb, wideScopeArb, (src, scope) => {
        const ast = parseTyped(src);
        if (ast instanceof ExpressionSyntaxError) return;
        const res = evaluateExpression(ast, scope);
        expect(typeof res.value).toBe("boolean");
        // A forced-false result always says why; a normal result never carries a problem.
        if (res.value) expect(res.problem).toBeUndefined();
      }),
      params(300),
    );
  });

  it("evaluation is total for generated well-formed expressions over arbitrary JSON", () => {
    fc.assert(
      fc.property(exprArb(wideLeafArb, 4), wideScopeArb, (ast, scope) => {
        const res = evaluateExpression(ast, scope);
        expect(typeof res.value).toBe("boolean");
      }),
      params(200),
    );
  });

  it("checkExpression never throws and an empty result means the source parses", () => {
    const ctx = {
      from: "n2",
      ancestors: new Set(["n1"]),
      outputs: {
        n1: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            sev: { type: "string", enum: ["high", "low"] },
            n: { type: "number" },
          },
        },
        n2: undefined,
      },
    };
    fc.assert(
      fc.property(anySourceArb, (src) => {
        const problems = checkExpression(src, ctx);
        expect(Array.isArray(problems)).toBe(true);
        for (const p of problems) expect(typeof p).toBe("string");
        if (problems.length === 0) expect(parseTyped(src)).not.toBeInstanceOf(ExpressionSyntaxError);
      }),
      params(200),
    );
  });
});

describe("when: round trip of well-formed expressions", () => {
  it("parse(render(ast)) is the same ast, for any generated shape, string and number", () => {
    fc.assert(
      fc.property(exprArb(wideLeafArb, 4), (ast) => {
        const src = render(ast);
        expect(src.length).toBeLessThanOrEqual(WHEN_EXPR_MAX_LENGTH);
        expect(parseExpression(src)).toEqual(ast);
      }),
      params(300),
    );
  });

  it("evaluation agrees with an independent reference implementation of the documented rules", () => {
    fc.assert(
      fc.property(exprArb(evalLeafArb, 4), evalScopeArb, (ast, scope) => {
        const expected = reference(ast, scope);
        const actual = evaluateExpression(parseExpression(render(ast)), scope);
        expect(actual.value).toBe(expected.value);
        expect(actual.problem !== undefined).toBe(expected.problem);
      }),
      params(500),
    );
  });

  it("negation flips a defined result and can never turn a problem into true", () => {
    fc.assert(
      fc.property(exprArb(evalLeafArb, 3), evalScopeArb, (ast, scope) => {
        const base = evaluateExpression(ast, scope);
        const negated = evaluateExpression({ kind: "not", operand: ast }, scope);
        if (base.problem === undefined) {
          expect(negated.value).toBe(!base.value);
          expect(negated.problem).toBeUndefined();
        } else {
          expect(negated.value).toBe(false);
          expect(negated.problem).toBeDefined();
        }
      }),
      params(300),
    );
  });
});

describe("when: a missing field never makes an expression true", () => {
  const missingLeaf: fc.Arbitrary<ExprNode> = fc.oneof(
    fc.constantFrom(...MISSING_PATHS).map(pathNode),
    fc
      .tuple(fc.constantFrom(...MISSING_PATHS), fc.constantFrom(...CMP_OPS), smallLiteralArb)
      .map(([p, op, lit]): ExprNode => ({
        kind: "cmp",
        op,
        left: pathNode(p),
        right: { kind: "literal", value: lit },
      })),
    fc
      .tuple(smallLiteralArb, fc.constantFrom(...CMP_OPS), fc.constantFrom(...MISSING_PATHS))
      .map(([lit, op, p]): ExprNode => ({
        kind: "cmp",
        op,
        left: { kind: "literal", value: lit },
        right: pathNode(p),
      })),
    fc
      .tuple(fc.constantFrom(...MISSING_PATHS), fc.array(smallLiteralArb, { maxLength: 3 }))
      .map(([p, items]): ExprNode => ({ kind: "cmp", op: "in", left: pathNode(p), right: { kind: "list", items } })),
  );

  it("any and/or/! combination of missing-field tests is false, with a reported problem", () => {
    const combos = fc.memo<ExprNode>((n) => {
      if (n <= 1) return missingLeaf;
      const sub = combos(n - 1);
      return fc.oneof(
        missingLeaf,
        sub.map((operand): ExprNode => ({ kind: "not", operand })),
        fc
          .tuple(fc.constantFrom<"and" | "or">("and", "or"), sub, sub)
          .map(([kind, left, right]): ExprNode => ({ kind, left, right })),
      );
    });
    fc.assert(
      fc.property(combos(4), evalScopeArb, (ast, scope) => {
        const res = evaluateExpression(ast, scope);
        expect(res.value).toBe(false);
        expect(res.problem).toBeDefined();
        // Same through the source form.
        const viaSource = evaluateExpression(parseExpression(render(ast)), scope);
        expect(viaSource.value).toBe(false);
      }),
      params(300),
    );
  });

  it("a missing field evaluated anywhere forces the whole expression false, even beside `|| true`", () => {
    fc.assert(
      fc.property(fc.constantFrom(...MISSING_PATHS), evalScopeArb, (p, scope) => {
        const path = p.join(".");
        for (const src of [
          `${path} == 1 || true`,
          `true && ${path} == 1`,
          `!(${path} == 1) || true`,
          `${path} != 1`,
          `!(${path} != 1)`,
        ]) {
          const res = evaluateExpression(parseExpression(src), scope);
          expect(res.value).toBe(false);
          expect(res.problem).toBeDefined();
        }
        // The documented explicit presence tests are the only way to branch on absence.
        expect(evaluateExpression(parseExpression(`exists ${path}`), scope)).toEqual({ value: false });
        expect(evaluateExpression(parseExpression(`!exists ${path}`), scope)).toEqual({ value: true });
        expect(evaluateExpression(parseExpression(`exists ${path} && ${path} > 0`), scope)).toEqual({ value: false });
      }),
      params(100),
    );
  });

  it("a node that did not run (undefined) or a null value reads as missing / non-present", () => {
    fc.assert(
      fc.property(fc.constantFrom("==", "!=", "<", ">", "in"), (op) => {
        const rhs = op === "in" ? "[1, 2]" : "1";
        const skipped: ExpressionScope = { a: undefined };
        expect(evaluateExpression(parseExpression(`a.b ${op} ${rhs}`), skipped).value).toBe(false);
        expect(evaluateExpression(parseExpression(`a.b ${op} ${rhs}`), skipped).problem).toBeDefined();
        const nulled: ExpressionScope = { a: { b: null } };
        expect(evaluateExpression(parseExpression(`exists a.b`), nulled).value).toBe(false);
      }),
      params(20),
    );
  });
});

describe("when: nesting depth and length are bounded", () => {
  it("parenthesis nesting past the cap is a syntax error, never a stack overflow", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 990 }), (n) => {
        const src = "(".repeat(n) + "a.b" + ")".repeat(n);
        const r = parseTyped(src);
        if (n <= 32) {
          expect(r).not.toBeInstanceOf(ExpressionSyntaxError);
          expect(evaluateExpression(r as ExprNode, { a: { b: true } })).toEqual({ value: true });
        }
        if (n >= 64) expect(r).toBeInstanceOf(ExpressionSyntaxError);
      }),
      params(150),
    );
  });

  it("chained negation past the cap is a syntax error; below it the parity is right", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1900 }), (n) => {
        const r = parseTyped("!".repeat(n) + "a.b");
        if (n <= 32) {
          expect(r).not.toBeInstanceOf(ExpressionSyntaxError);
          expect(evaluateExpression(r as ExprNode, { a: { b: true } }).value).toBe(n % 2 === 0);
        }
        if (n >= 64) expect(r).toBeInstanceOf(ExpressionSyntaxError);
      }),
      params(150),
    );
  });

  it("mixed `!(` nesting is bounded too", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 650 }), (n) => {
        const r = parseTyped("!(".repeat(n) + "a.b" + ")".repeat(n));
        if (n >= 64) expect(r).toBeInstanceOf(ExpressionSyntaxError);
      }),
      params(100),
    );
  });

  it("a source over the length cap is rejected before it is tokenized; at the cap it still parses", () => {
    expect(() => parseExpression("a.b == 1".padEnd(WHEN_EXPR_MAX_LENGTH, " "))).not.toThrow();
    fc.assert(
      fc.property(
        fc.integer({ min: WHEN_EXPR_MAX_LENGTH + 1, max: 50_000 }),
        fc.constantFrom(" ", "(", "a", "!", "'"),
        (len, pad) => {
          const r = parseTyped("a.b == 1".padEnd(len, pad));
          expect(r).toBeInstanceOf(ExpressionSyntaxError);
          expect((r as ExpressionSyntaxError).message).toContain(String(WHEN_EXPR_MAX_LENGTH));
        },
      ),
      params(60),
    );
  });

  it("long flat chains stay inside the cap and evaluate without recursion trouble", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 160 }),
        fc.constantFrom("&&", "||"),
        fc.integer({ min: 1, max: 2 }),
        (k, op, v) => {
          const src = Array.from({ length: k }, () => "a.b == 1").join(` ${op} `);
          expect(src.length).toBeLessThanOrEqual(WHEN_EXPR_MAX_LENGTH);
          const res = evaluateExpression(parseExpression(src), { a: { b: v } });
          expect(res).toEqual({ value: v === 1 });
        },
      ),
      params(60),
    );
  });

  it("the empty and blank sources are syntax errors", () => {
    fc.assert(
      fc.property(fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 30 }), (blank) => {
        expect(parseTyped(blank)).toBeInstanceOf(ExpressionSyntaxError);
      }),
      params(30),
    );
  });
});
