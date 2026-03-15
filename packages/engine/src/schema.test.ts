import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { triageDefinition, implementDefinition } from "./index.js";
import schema from "../schema/recipe-definition.schema.json" with { type: "json" };

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

describe("recipe-definition.schema.json", () => {
  it("triageDefinition passes schema validation", () => {
    const valid = validate(triageDefinition);
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it("implementDefinition passes schema validation", () => {
    const valid = validate(implementDefinition);
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it("rejects a definition with missing required fields", () => {
    const valid = validate({ id: "bad", version: "1.0.0" }); // missing name, initial, states
    expect(valid).toBe(false);
    expect(validate.errors).not.toBeNull();
  });

  it("rejects an invalid phase value", () => {
    const valid = validate({
      id: "bad",
      version: "1.0.0",
      name: "bad",
      initial: "a",
      steps: { a: { phase: "deploy" } }, // invalid phase
    });
    expect(valid).toBe(false);
  });

  it("rejects empty states object", () => {
    const valid = validate({
      id: "bad",
      version: "1.0.0",
      name: "bad",
      initial: "a",
      steps: {},
    });
    expect(valid).toBe(false);
  });

  it("rejects invalid semver version string", () => {
    const valid = validate({
      id: "bad",
      version: "not-semver",
      name: "bad",
      initial: "a",
      steps: { a: { phase: "learn" } },
    });
    expect(valid).toBe(false);
  });
});
