import { describe, it, expect } from "vitest";
import { formatResultJson } from "./output.js";
import { createStreamObserver } from "./stream-observer.js";
import { runSecretValues } from "../journal.js";
import type { ExecutionEvent, NodeResult } from "../types.js";

// A granted agent_env value and a ghp_-shaped token must never reach --json or --stream.
const CANARY = "canary-agent-env-value-9f8e7d6c";
const GHP = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4";
const secrets = runSecretValues(undefined, { DEPLOY_SECRET: CANARY });

const result = (over: Partial<NodeResult> = {}): NodeResult => ({
  status: "success",
  data: {
    note: `deployed with ${CANARY}`,
    declared: GHP,
    count: 3,
    plain: "hello world",
    nested: { list: [`x ${GHP} y`, "ok"] },
  },
  toolCalls: [
    { tool: "github_get", input: { header: `Bearer ${GHP}`, repo: "acme/app" }, output: { body: `echo ${CANARY}` } },
  ],
  ...over,
});

const failedResult = (): NodeResult => result({ status: "failed", data: { error: `boom ${CANARY} ${GHP}` } });

describe("--json redaction", () => {
  it("never prints the canary or a ghp_ token, and keeps structure and plain values", () => {
    const out = formatResultJson(
      new Map([
        ["a", result()],
        ["b", failedResult()],
      ]),
      secrets,
    );
    expect(out).not.toContain(CANARY);
    expect(out).not.toContain(GHP);
    expect(out).toContain("[redacted]");
    const parsed = JSON.parse(out);
    expect(Object.keys(parsed)).toEqual(["a", "b"]);
    expect(parsed.a.status).toBe("success");
    expect(parsed.a.data.plain).toBe("hello world");
    expect(parsed.a.data.count).toBe(3);
    expect(parsed.a.data.nested.list[1]).toBe("ok");
    expect(parsed.a.toolCalls[0].input.repo).toBe("acme/app");
    expect(parsed.a.toolCalls[0].tool).toBe("github_get");
  });

  it("redacts known token shapes even with no granted secrets", () => {
    const out = formatResultJson(new Map([["a", result()]]));
    expect(out).not.toContain(GHP);
  });
});

describe("--stream redaction", () => {
  it("never emits the canary or a ghp_ token in any event, and keeps keys and plain values", () => {
    const lines: string[] = [];
    const observe = createStreamObserver(secrets, (l) => lines.push(l));
    const events: ExecutionEvent[] = [
      { type: "workflow:start", workflow: "wf" },
      { type: "node:enter", node: "a", instruction: "do it" },
      { type: "tool:call", node: "a", tool: "github_get", input: { header: `Bearer ${GHP}`, repo: "acme/app" } },
      { type: "tool:result", node: "a", tool: "github_get", output: { body: `echo ${CANARY}` } },
      { type: "node:progress", node: "a", message: `using ${CANARY}` },
      { type: "node:exit", node: "a", result: result() },
      { type: "node:exit", node: "b", result: failedResult() },
      { type: "workflow:end", results: { a: result(), b: failedResult() } },
    ];
    for (const e of events) observe(e);

    const all = lines.join("");
    expect(all).not.toContain(CANARY);
    expect(all).not.toContain(GHP);
    expect(lines).toHaveLength(events.length);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed.map((p) => p.type)).toEqual(events.map((e) => e.type));
    expect(parsed[2].input.repo).toBe("acme/app");
    expect(parsed[5].result.data.plain).toBe("hello world");
    expect(parsed[1].instruction).toBe("do it");
  });
});
