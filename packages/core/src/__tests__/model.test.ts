import { describe, it, expect } from "vitest";
import { resolveExecutionModel } from "../model.js";
import type { Node, Workflow } from "../types.js";

function node(model?: string): Node {
  return { name: "n", instruction: "do", skills: [], ...(model ? { model } : {}) };
}

function workflow(model?: string): Workflow {
  return {
    id: "w",
    name: "W",
    description: "",
    nodes: {},
    edges: [],
    entry: "n",
    ...(model ? { model } : {}),
  };
}

describe("resolveExecutionModel", () => {
  it("prefers the node model over the workflow model", () => {
    expect(resolveExecutionModel(node("claude-haiku-4-5"), workflow("claude-opus-4-6"))).toBe("claude-haiku-4-5");
  });

  it("falls back to the workflow model when the node has none", () => {
    expect(resolveExecutionModel(node(), workflow("claude-opus-4-6"))).toBe("claude-opus-4-6");
  });

  it("returns undefined when neither specifies a model (client default applies downstream)", () => {
    expect(resolveExecutionModel(node(), workflow())).toBeUndefined();
  });

  it("tolerates undefined node / workflow", () => {
    expect(resolveExecutionModel(undefined, undefined)).toBeUndefined();
    expect(resolveExecutionModel(undefined, workflow("m"))).toBe("m");
    expect(resolveExecutionModel(node("m"), undefined)).toBe("m");
  });
});
