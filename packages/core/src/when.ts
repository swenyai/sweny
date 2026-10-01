/**
 * Deterministic `when` expressions (#461).
 *
 * An edge's `when` is either natural language (a model picks the edge at
 * runtime) or `{ expr: "..." }`, a small boolean expression over prior nodes'
 * declared output fields that sweny evaluates itself, with no model call.
 *
 * Grammar (precedence low to high):
 *
 *   expr       := or
 *   or         := and ( "||" and )*
 *   and        := unary ( "&&" unary )*
 *   unary      := "!" unary | comparison
 *   comparison := operand ( ( "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" ) operand )?
 *   operand    := literal | list | path | "exists" path | "(" expr ")"
 *   list       := "[" ( literal ( "," literal )* )? "]"
 *   literal    := number | 'string' | "string" | true | false | null
 *   path       := ident ( "." ident )+          (node id, then field, then nested fields)
 *
 * Semantics are strict and total. There is no coercion and no truthiness:
 * `&&`, `||`, `!` and the expression itself need booleans; `<` and friends
 * need two numbers or two strings; `in` needs a list on the right. A missing
 * field (undefined, or a node that did not run or did not succeed) or a type
 * mismatch makes the WHOLE expression false and is reported, so a negation
 * can never turn a missing field into a silent true. `exists path` is the
 * one explicit presence test: true when the value is present and not null,
 * never a warning. `&&` and `||` short-circuit, so `exists a.x && a.x > 0`
 * is safe.
 *
 * Pure module: no I/O, no eval, no Function, browser-safe. Strings in the
 * routed data are compared as data only; nothing in them is ever parsed.
 */

import type { EdgeWhen, JSONSchema, WhenExpression } from "./types.js";

/** Longest expression source accepted. Routing conditions are short. */
export const WHEN_EXPR_MAX_LENGTH = 2000;
/** Deepest nesting accepted (parens, `!`, operators), so recursion stays bounded. */
const MAX_DEPTH = 64;

// ─── Edge `when` helpers ─────────────────────────────────────────

/** True when an edge `when` is the structured `{ expr }` form. */
export function isWhenExpression(when: unknown): when is WhenExpression {
  return (
    when !== null &&
    typeof when === "object" &&
    !Array.isArray(when) &&
    typeof (when as Record<string, unknown>).expr === "string"
  );
}

/** Human-readable label for a `when`: the NL text or the expression source. */
export function whenLabel(when: EdgeWhen | undefined): string | undefined {
  if (when === undefined) return undefined;
  return isWhenExpression(when) ? when.expr : when;
}

// ─── AST ─────────────────────────────────────────────────────────

export type Literal = string | number | boolean | null;

export type ExprNode =
  | { kind: "literal"; value: Literal }
  | { kind: "list"; items: Literal[] }
  | { kind: "path"; segments: string[] }
  | { kind: "exists"; path: { kind: "path"; segments: string[] } }
  | { kind: "not"; operand: ExprNode }
  | { kind: "and" | "or"; left: ExprNode; right: ExprNode }
  | { kind: "cmp"; op: CmpOp; left: ExprNode; right: ExprNode };

export type CmpOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in";

export class ExpressionSyntaxError extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(`${message} (at position ${position})`);
    this.name = "ExpressionSyntaxError";
  }
}

// ─── Tokenizer ───────────────────────────────────────────────────

type Token =
  | { t: "op"; v: string; pos: number }
  | { t: "num"; v: number; pos: number }
  | { t: "str"; v: string; pos: number }
  | { t: "ident"; v: string; pos: number }
  | { t: "eof"; pos: number };

const TWO_CHAR_OPS = new Set(["&&", "||", "==", "!=", "<=", ">="]);
const ONE_CHAR_OPS = new Set(["!", "<", ">", "(", ")", "[", "]", ",", "."]);
const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_-]/;
const DIGIT = /[0-9]/;

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ t: "op", v: two, pos: i });
      i += 2;
      continue;
    }
    if (c === "=" || c === "&" || c === "|") {
      const hint = c === "=" ? "==" : c + c;
      throw new ExpressionSyntaxError(`unexpected '${c}'; did you mean '${hint}'?`, i);
    }
    if (ONE_CHAR_OPS.has(c)) {
      tokens.push({ t: "op", v: c, pos: i });
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const start = i;
      let out = "";
      i++;
      for (;;) {
        if (i >= src.length) throw new ExpressionSyntaxError("unterminated string", start);
        const ch = src[i];
        if (ch === c) {
          i++;
          break;
        }
        if (ch === "\\") {
          const nx = src[i + 1];
          if (nx === "\\" || nx === "'" || nx === '"') out += nx;
          else if (nx === "n") out += "\n";
          else if (nx === "t") out += "\t";
          else throw new ExpressionSyntaxError(`unknown escape '\\${nx ?? ""}'`, i);
          i += 2;
          continue;
        }
        out += ch;
        i++;
      }
      tokens.push({ t: "str", v: out, pos: start });
      continue;
    }
    if (DIGIT.test(c) || (c === "-" && DIGIT.test(src[i + 1] ?? ""))) {
      const start = i;
      if (c === "-") i++;
      while (i < src.length && DIGIT.test(src[i])) i++;
      if (src[i] === "." && DIGIT.test(src[i + 1] ?? "")) {
        i++;
        while (i < src.length && DIGIT.test(src[i])) i++;
      }
      if (i < src.length && IDENT_PART.test(src[i])) {
        throw new ExpressionSyntaxError(`malformed number '${src.slice(start, i + 1)}'`, start);
      }
      tokens.push({ t: "num", v: Number(src.slice(start, i)), pos: start });
      continue;
    }
    if (IDENT_START.test(c)) {
      const start = i;
      while (i < src.length && IDENT_PART.test(src[i])) i++;
      tokens.push({ t: "ident", v: src.slice(start, i), pos: start });
      continue;
    }
    throw new ExpressionSyntaxError(`unexpected character '${c}'`, i);
  }
  tokens.push({ t: "eof", pos: src.length });
  return tokens;
}

// ─── Parser ──────────────────────────────────────────────────────

const KEYWORDS = new Set(["true", "false", "null", "in", "exists"]);
const CMP_OPS = new Set(["==", "!=", "<", "<=", ">", ">="]);

/**
 * Parse an expression source into an AST. Throws `ExpressionSyntaxError` on
 * any syntax problem, including an empty source, an over-long source, or
 * nesting deeper than the cap.
 */
export function parseExpression(src: string): ExprNode {
  if (typeof src !== "string" || src.trim() === "") {
    throw new ExpressionSyntaxError("empty expression", 0);
  }
  if (src.length > WHEN_EXPR_MAX_LENGTH) {
    throw new ExpressionSyntaxError(`expression longer than ${WHEN_EXPR_MAX_LENGTH} characters`, 0);
  }
  const tokens = tokenize(src);
  let p = 0;
  let depth = 0;

  const peek = (): Token => tokens[p];
  const isOp = (v: string): boolean => {
    const tk = tokens[p];
    return tk.t === "op" && tk.v === v;
  };
  const isKw = (v: string): boolean => {
    const tk = tokens[p];
    return tk.t === "ident" && tk.v === v;
  };
  const describe = (tk: Token): string =>
    tk.t === "eof" ? "end of expression" : tk.t === "str" ? `string '${tk.v}'` : `'${String(tk.v)}'`;
  const expectOp = (v: string): void => {
    if (!isOp(v)) throw new ExpressionSyntaxError(`expected '${v}' but found ${describe(peek())}`, peek().pos);
    p++;
  };
  const enter = (): void => {
    if (++depth > MAX_DEPTH) throw new ExpressionSyntaxError(`nesting deeper than ${MAX_DEPTH}`, peek().pos);
  };

  function parseOr(): ExprNode {
    enter();
    let left = parseAnd();
    while (isOp("||")) {
      p++;
      left = { kind: "or", left, right: parseAnd() };
    }
    depth--;
    return left;
  }

  function parseAnd(): ExprNode {
    let left = parseUnary();
    while (isOp("&&")) {
      p++;
      left = { kind: "and", left, right: parseUnary() };
    }
    return left;
  }

  function parseUnary(): ExprNode {
    if (isOp("!")) {
      p++;
      enter();
      const operand = parseUnary();
      depth--;
      return { kind: "not", operand };
    }
    return parseComparison();
  }

  function parseComparison(): ExprNode {
    const left = parseOperand();
    const tk = peek();
    if (tk.t === "op" && CMP_OPS.has(tk.v)) {
      p++;
      return { kind: "cmp", op: tk.v as CmpOp, left, right: parseOperand() };
    }
    if (isKw("in")) {
      p++;
      return { kind: "cmp", op: "in", left, right: parseOperand() };
    }
    return left;
  }

  function parsePath(): { kind: "path"; segments: string[] } {
    const tk = peek();
    if (tk.t !== "ident" || KEYWORDS.has(tk.v)) {
      throw new ExpressionSyntaxError(`expected a field path but found ${describe(tk)}`, tk.pos);
    }
    p++;
    const segments = [tk.v];
    while (isOp(".")) {
      p++;
      const seg = peek();
      if (seg.t !== "ident") {
        throw new ExpressionSyntaxError(`expected a field name after '.' but found ${describe(seg)}`, seg.pos);
      }
      p++;
      segments.push(seg.v);
    }
    if (segments.length < 2) {
      throw new ExpressionSyntaxError(
        `path '${tk.v}' needs a node and a field (e.g. '${tk.v}.field'); quote it if you meant a string`,
        tk.pos,
      );
    }
    return { kind: "path", segments };
  }

  function parseLiteral(): Literal {
    const tk = peek();
    if (tk.t === "num" || tk.t === "str") {
      p++;
      return tk.v;
    }
    if (tk.t === "ident" && (tk.v === "true" || tk.v === "false" || tk.v === "null")) {
      p++;
      return tk.v === "null" ? null : tk.v === "true";
    }
    throw new ExpressionSyntaxError(`expected a literal but found ${describe(tk)}`, tk.pos);
  }

  function parseOperand(): ExprNode {
    const tk = peek();
    if (isOp("(")) {
      p++;
      const inner = parseOr();
      expectOp(")");
      return inner;
    }
    if (isOp("[")) {
      p++;
      const items: Literal[] = [];
      if (!isOp("]")) {
        items.push(parseLiteral());
        while (isOp(",")) {
          p++;
          items.push(parseLiteral());
        }
      }
      expectOp("]");
      return { kind: "list", items };
    }
    if (tk.t === "num" || tk.t === "str") return { kind: "literal", value: parseLiteral() };
    if (tk.t === "ident") {
      if (tk.v === "true" || tk.v === "false" || tk.v === "null") return { kind: "literal", value: parseLiteral() };
      if (tk.v === "exists") {
        p++;
        return { kind: "exists", path: parsePath() };
      }
      if (tk.v === "in") throw new ExpressionSyntaxError(`unexpected 'in'`, tk.pos);
      return parsePath();
    }
    throw new ExpressionSyntaxError(`unexpected ${describe(tk)}`, tk.pos);
  }

  const ast = parseOr();
  if (peek().t !== "eof") {
    throw new ExpressionSyntaxError(`unexpected ${describe(peek())} after a complete expression`, peek().pos);
  }
  return ast;
}

// ─── Evaluator ───────────────────────────────────────────────────

/**
 * Per-node data an expression may read, keyed by node id. A node that did not
 * run or did not succeed is absent, so every path into it reads as missing.
 */
export type ExpressionScope = Record<string, Record<string, unknown> | undefined>;

export interface ExpressionResult {
  /** The edge is taken only when this is true. */
  value: boolean;
  /**
   * Why the expression was forced false: a missing field or a type mismatch.
   * Absent when it evaluated normally (to true or false).
   */
  problem?: string;
}

class Abort extends Error {}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "list";
  return typeof v;
}

function isPrimitive(v: unknown): v is Literal {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function lookup(scope: ExpressionScope, segments: string[]): unknown {
  let cur: unknown = Object.prototype.hasOwnProperty.call(scope, segments[0]) ? scope[segments[0]] : undefined;
  for (let i = 1; i < segments.length; i++) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    const obj = cur as Record<string, unknown>;
    cur = Object.prototype.hasOwnProperty.call(obj, segments[i]) ? obj[segments[i]] : undefined;
  }
  return cur;
}

/**
 * Evaluate a parsed expression against node outputs. Never throws: a missing
 * field or a type mismatch yields `{ value: false, problem }`.
 */
export function evaluateExpression(ast: ExprNode, scope: ExpressionScope): ExpressionResult {
  const read = (path: string[]): unknown => {
    const v = lookup(scope, path);
    if (v === undefined) throw new Abort(`field '${path.join(".")}' is missing`);
    return v;
  };
  const bool = (v: unknown, where: string): boolean => {
    if (typeof v !== "boolean") throw new Abort(`${where} needs a boolean, got ${typeName(v)}`);
    return v;
  };

  function ev(node: ExprNode): unknown {
    switch (node.kind) {
      case "literal":
        return node.value;
      case "list":
        return node.items;
      case "path":
        return read(node.segments);
      case "exists": {
        const v = lookup(scope, node.path.segments);
        return v !== undefined && v !== null;
      }
      case "not":
        return !bool(ev(node.operand), "'!'");
      case "and":
        return bool(ev(node.left), "'&&'") ? bool(ev(node.right), "'&&'") : false;
      case "or":
        return bool(ev(node.left), "'||'") ? true : bool(ev(node.right), "'||'");
      case "cmp": {
        const l = ev(node.left);
        const r = ev(node.right);
        if (node.op === "in") {
          if (!Array.isArray(r)) throw new Abort(`'in' needs a list on the right, got ${typeName(r)}`);
          if (!isPrimitive(l)) throw new Abort(`'in' needs a string, number, boolean or null on the left`);
          return r.some((x) => x === l);
        }
        if (node.op === "==" || node.op === "!=") {
          if (!isPrimitive(l) || !isPrimitive(r)) {
            throw new Abort(
              `'${node.op}' compares strings, numbers, booleans or null, got ${typeName(l)} and ${typeName(r)}`,
            );
          }
          return node.op === "==" ? l === r : l !== r;
        }
        const bothNum = typeof l === "number" && typeof r === "number";
        const bothStr = typeof l === "string" && typeof r === "string";
        if (!bothNum && !bothStr) {
          throw new Abort(`'${node.op}' needs two numbers or two strings, got ${typeName(l)} and ${typeName(r)}`);
        }
        const a = l as number | string;
        const b = r as number | string;
        switch (node.op) {
          case "<":
            return a < b;
          case "<=":
            return a <= b;
          case ">":
            return a > b;
          default:
            return a >= b;
        }
      }
    }
  }

  try {
    const v = ev(ast);
    if (typeof v !== "boolean") return { value: false, problem: `expression produced ${typeName(v)}, not a boolean` };
    return { value: v };
  } catch (err) {
    if (err instanceof Abort) return { value: false, problem: err.message };
    throw err;
  }
}

// ─── Load-time checks ────────────────────────────────────────────

/**
 * Check an expression against the workflow it routes. Returns one message per
 * problem, empty when the expression is valid:
 *   - the source must parse;
 *   - every path's node must be the edge's source or one of its ancestors;
 *   - that node must declare `output.properties`, and the field (and any
 *     nested field) must be declared there;
 *   - a literal compared with a declared field must fit its declared type,
 *     and a string literal compared with an enum field must be in the enum;
 *   - a field used where a boolean is needed must be declared boolean.
 */
export function checkExpression(
  src: string,
  ctx: { from: string; ancestors: Set<string>; outputs: Record<string, JSONSchema | undefined> },
): string[] {
  let ast: ExprNode;
  try {
    ast = parseExpression(src);
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)];
  }

  const problems: string[] = [];
  const resolved = new Map<ExprNode, Record<string, unknown> | null>();

  const resolve = (segments: string[], node: ExprNode): void => {
    const [nodeId, ...fields] = segments;
    const label = segments.join(".");
    if (!Object.prototype.hasOwnProperty.call(ctx.outputs, nodeId)) {
      problems.push(`'${label}': no node named '${nodeId}'`);
      return;
    }
    if (!ctx.ancestors.has(nodeId)) {
      problems.push(`'${label}': node '${nodeId}' does not run before '${ctx.from}' on any path`);
      return;
    }
    let schema = ctx.outputs[nodeId] as Record<string, unknown> | undefined;
    const props0 = schema?.properties;
    if (!props0 || typeof props0 !== "object" || Object.keys(props0).length === 0) {
      problems.push(`'${label}': node '${nodeId}' declares no output.properties, so it has no fields to route on`);
      return;
    }
    for (let i = 0; i < fields.length; i++) {
      const props = schema?.properties as Record<string, unknown> | undefined;
      if (!props || typeof props !== "object") {
        if (schema && schema.type === "array") {
          problems.push(
            `'${label}': '${[nodeId, ...fields.slice(0, i)].join(".")}' is a list; expressions cannot index lists`,
          );
        } else if (
          schema &&
          (schema.type === "string" ||
            schema.type === "number" ||
            schema.type === "integer" ||
            schema.type === "boolean")
        ) {
          problems.push(
            `'${label}': '${[nodeId, ...fields.slice(0, i)].join(".")}' is a ${String(schema.type)}, not an object`,
          );
        } else {
          // Free-form object: nested fields are not declared, so accept them.
          resolved.set(node, null);
          return;
        }
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(props, fields[i])) {
        problems.push(
          `'${label}': '${fields[i]}' is not a declared output field of '${[nodeId, ...fields.slice(0, i)].join(".")}'`,
        );
        return;
      }
      schema = props[fields[i]] as Record<string, unknown> | undefined;
    }
    resolved.set(node, schema && typeof schema === "object" ? schema : null);
  };

  const walk = (n: ExprNode): void => {
    switch (n.kind) {
      case "path":
        resolve(n.segments, n);
        return;
      case "exists":
        resolve(n.path.segments, n.path);
        return;
      case "not":
        walk(n.operand);
        return;
      case "and":
      case "or":
      case "cmp":
        walk(n.left);
        walk(n.right);
        return;
      default:
        return;
    }
  };
  walk(ast);
  if (problems.length > 0) return problems;

  const declaredTypes = (s: Record<string, unknown>): Set<string> | null => {
    const t = s.type;
    if (typeof t === "string") return new Set([t]);
    if (Array.isArray(t)) return new Set(t.filter((x): x is string => typeof x === "string"));
    return null;
  };
  const literalFits = (v: Literal, types: Set<string>): boolean => {
    if (v === null) return types.has("null");
    if (typeof v === "string") return types.has("string");
    if (typeof v === "boolean") return types.has("boolean");
    return types.has("number") || (types.has("integer") && Number.isInteger(v));
  };
  const label = (n: ExprNode): string => (n.kind === "path" ? n.segments.join(".") : "");

  const checkLiteralAgainst = (pathNode: ExprNode, lit: Literal): void => {
    const s = resolved.get(pathNode);
    if (!s) return;
    // `== null` / `!= null` is always allowed: an optional field can be null.
    if (lit === null) return;
    const types = declaredTypes(s);
    if (types && !literalFits(lit, types)) {
      problems.push(
        `'${label(pathNode)}' is declared ${[...types].join("|")} but is compared with ${JSON.stringify(lit)}`,
      );
      return;
    }
    if (Array.isArray(s.enum) && typeof lit === "string" && !s.enum.includes(lit)) {
      problems.push(
        `'${label(pathNode)}' never equals ${JSON.stringify(lit)}; its declared values are ${JSON.stringify(s.enum)}`,
      );
    }
  };

  const checkBooleanPosition = (n: ExprNode): void => {
    if ((n.kind === "literal" && typeof n.value !== "boolean") || n.kind === "list") {
      problems.push(
        `${n.kind === "list" ? "a list" : JSON.stringify(n.kind === "literal" ? n.value : null)} is not a boolean`,
      );
      return;
    }
    if (n.kind !== "path") return;
    const s = resolved.get(n);
    if (!s) return;
    const types = declaredTypes(s);
    if (types && !types.has("boolean")) {
      problems.push(`'${label(n)}' is declared ${[...types].join("|")}; use a comparison, it is not a boolean`);
    }
  };

  const check = (n: ExprNode): void => {
    switch (n.kind) {
      case "not":
        checkBooleanPosition(n.operand);
        check(n.operand);
        return;
      case "and":
      case "or":
        checkBooleanPosition(n.left);
        checkBooleanPosition(n.right);
        check(n.left);
        check(n.right);
        return;
      case "cmp":
        if (n.op === "in") {
          if (n.left.kind === "path" && n.right.kind === "list") {
            for (const item of n.right.items) checkLiteralAgainst(n.left, item);
          }
        } else if (n.left.kind === "path" && n.right.kind === "literal") {
          checkLiteralAgainst(n.left, n.right.value);
        } else if (n.right.kind === "path" && n.left.kind === "literal") {
          checkLiteralAgainst(n.right, n.left.value);
        }
        check(n.left);
        check(n.right);
        return;
      default:
        return;
    }
  };
  checkBooleanPosition(ast);
  check(ast);
  return problems;
}
