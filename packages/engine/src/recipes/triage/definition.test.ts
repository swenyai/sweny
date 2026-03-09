import { describe, it, expect } from "vitest";
import { triageDefinition } from "./definition.js";
import { triageRecipe } from "./index.js";
import { implementDefinition } from "../implement/definition.js";
import { implementRecipe } from "../implement/index.js";

describe("recipe definition — single source of truth", () => {
  it("triageRecipe.definition is the same object reference as triageDefinition", () => {
    expect(triageRecipe.definition).toBe(triageDefinition);
  });

  it("implementRecipe.definition is the same object reference as implementDefinition", () => {
    expect(implementRecipe.definition).toBe(implementDefinition);
  });

  it("triageDefinition is JSON-serializable", () => {
    expect(() => JSON.stringify(triageDefinition)).not.toThrow();
  });

  it("implementDefinition is JSON-serializable", () => {
    expect(() => JSON.stringify(implementDefinition)).not.toThrow();
  });
});
