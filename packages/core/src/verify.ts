// ─── Verify: path resolver + check evaluators ───────────────────────
//
// Evaluates `node.verify` post-conditions after the LLM finishes.
// All checks are AND-ed; failures are aggregated into one error string.

export type Resolution = { ok: true; mode: "all" | "any"; values: unknown[] } | { ok: false; reason: string };

interface Segment {
  name: string;
  wildcard: boolean;
}

const SEGMENT_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)(\[\*\])?$/;

function parsePath(path: string): { mode: "all" | "any"; segments: Segment[] } | string {
  if (path.length === 0) return "empty path";

  let mode: "all" | "any" = "all";
  let body = path;
  const colon = path.indexOf(":");
  if (colon !== -1 && /^[a-z]+$/.test(path.slice(0, colon))) {
    const prefix = path.slice(0, colon);
    if (prefix === "all" || prefix === "any") {
      mode = prefix;
      body = path.slice(colon + 1);
    } else {
      return `unknown prefix '${prefix}' (expected 'all' or 'any')`;
    }
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
