import { describe, it, expect } from "vitest";
import { triageDefinition } from "./definition.js";
import { triageWorkflow } from "./index.js";
import { implementDefinition } from "../implement/definition.js";
import { implementWorkflow } from "../implement/index.js";

describe("workflow definition — single source of truth", () => {
  it("triageWorkflow.definition is the same object reference as triageDefinition", () => {
    expect(triageWorkflow.definition).toBe(triageDefinition);
  });

  it("implementWorkflow.definition is the same object reference as implementDefinition", () => {
    expect(implementWorkflow.definition).toBe(implementDefinition);
  });

  it("triageDefinition is JSON-serializable", () => {
    expect(() => JSON.stringify(triageDefinition)).not.toThrow();
  });

  it("implementDefinition is JSON-serializable", () => {
    expect(() => JSON.stringify(implementDefinition)).not.toThrow();
  });
});
