// ─── Eval: path parser + resolver ────────────────────────────────────
//
// Shared by `value` evaluators (operate on `result.data`) and the `requires`
// pre-condition gate (operates on the cross-node context map). The grammar
// is documented at https://spec.sweny.ai/nodes/#path-grammar.

export type Resolution = { ok: true; mode: "all" | "any"; values: unknown[] } | { ok: false; reason: string };

interface Segment {
  name: string;
  wildcard: boolean;
}

const SEGMENT_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)(\[\*\])?$/;
const PREFIX_RE = /^([a-z]+):/;

function parsePath(path: string): { mode: "all" | "any"; segments: Segment[] } | string {
  if (path.length === 0) return "empty path";

  let mode: "all" | "any" = "all";
  let body = path;
  const prefixMatch = PREFIX_RE.exec(path);
  if (prefixMatch) {
    const prefix = prefixMatch[1]!;
    if (prefix !== "all" && prefix !== "any") {
      return `unknown prefix '${prefix}' (expected 'all' or 'any')`;
    }
    mode = prefix;
    body = path.slice(prefixMatch[0].length);
    if (body.length === 0) return "empty path after prefix";
  }

  const parts = body.split(".");
  const segments: Segment[] = [];
  for (const part of parts) {
    const m = SEGMENT_RE.exec(part);
    if (!m) return `malformed segment '${part}'`;
    segments.push({ name: m[1]!, wildcard: m[2] === "[*]" });
  }
  return { mode, segments };
}

export function resolvePath(data: unknown, path: string): Resolution {
  const parsed = parsePath(path);
  if (typeof parsed === "string") return { ok: false, reason: parsed };

  let current: unknown[] = [data];

  for (const seg of parsed.segments) {
    const next: unknown[] = [];
    for (const v of current) {
      if (v === null) return { ok: false, reason: `null encountered before segment '${seg.name}'` };
      if (typeof v !== "object") {
        return { ok: false, reason: `expected object before segment '${seg.name}', got ${typeof v}` };
      }
      const obj = v as Record<string, unknown>;
      if (!(seg.name in obj)) {
        return { ok: false, reason: `missing segment '${seg.name}'` };
      }
      const child = obj[seg.name];
      if (seg.wildcard) {
        if (!Array.isArray(child)) {
          return {
            ok: false,
            reason: `expected array at '${seg.name}', got ${child === null ? "null" : typeof child}`,
          };
        }
        for (const el of child) next.push(el);
      } else {
        next.push(child);
      }
    }
    current = next;
    if (current.length === 0) {
      return { ok: true, mode: parsed.mode, values: [] };
    }
  }

  return { ok: true, mode: parsed.mode, values: current };
}
