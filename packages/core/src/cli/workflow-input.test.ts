import { describe, it, expect } from "vitest";
import { mergeDryRunIntoInput } from "./workflow-input.js";
import { validateRuntimeInput } from "../inputs.js";

// #324: --dry-run must survive when --input replaces the config-derived
// input bag. The executor's fail-closed dry-run gate (executor.ts
// advanceFromNode) reads `input.dryRun` directly, so silently dropping it
// meant `sweny workflow run <file> --dry-run --input '{...}'` (what the
// GitHub Action and MCP server both pass) ran the full workflow, side
// effects included, despite the flag.

describe("mergeDryRunIntoInput", () => {
  it("leaves the input untouched when --dry-run was not passed", () => {
    const input = { foo: 1 };
    expect(mergeDryRunIntoInput(input, false)).toBe(input);
  });

  it("forces dryRun: true onto --input JSON that never mentioned it", () => {
    // This is the exact #324 regression: --input '{"foo":1}' with --dry-run
    // used to silently drop dryRun because the --input branch built
    // workflowInput from validated.value alone.
    const input = { foo: 1 };
    expect(mergeDryRunIntoInput(input, true)).toEqual({ foo: 1, dryRun: true });
  });

  it("does not downgrade a caller-supplied dryRun: true when --dry-run is absent", () => {
    const input = { dryRun: true, foo: 1 };
    expect(mergeDryRunIntoInput(input, false)).toBe(input);
    expect(mergeDryRunIntoInput(input, false).dryRun).toBe(true);
  });

  it("--dry-run always wins over a caller-supplied dryRun: false", () => {
    const input = { dryRun: false, foo: 1 };
    expect(mergeDryRunIntoInput(input, true)).toEqual({ dryRun: true, foo: 1 });
  });

  it("does not mutate the input object it was given", () => {
    const input = { foo: 1 };
    const merged = mergeDryRunIntoInput(input, true);
    expect(input).toEqual({ foo: 1 });
    expect(merged).not.toBe(input);
  });
});

// Integration-shaped: exercises the exact sequence workflowRunAction runs on
// the --input branch (validateRuntimeInput, then mergeDryRunIntoInput) so
// the fix is verified against the real input-validation contract, not just
// mergeDryRunIntoInput in isolation.
describe("--input branch: validateRuntimeInput + mergeDryRunIntoInput (#324)", () => {
  it("workflow with no declared inputs: --dry-run survives an --input JSON that omits it", () => {
    const raw = JSON.parse('{"issueIdentifier":"ISS-1"}');
    const validated = validateRuntimeInput(undefined, raw);
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error("unreachable");
    const workflowInput = mergeDryRunIntoInput(validated.value, /* config.dryRun from --dry-run */ true);
    expect(workflowInput).toEqual({ issueIdentifier: "ISS-1", dryRun: true });
  });

  it("workflow WITH a declared inputs contract: --dry-run still survives", () => {
    const declared = { issueIdentifier: { type: "string" as const, required: true } };
    const raw = JSON.parse('{"issueIdentifier":"ISS-1"}');
    const validated = validateRuntimeInput(declared, raw);
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error("unreachable");
    // Declared-inputs path doesn't itself carry dryRun; the CLI-level merge
    // is what has to add it back.
    expect(validated.value.dryRun).toBeUndefined();
    const workflowInput = mergeDryRunIntoInput(validated.value, true);
    expect(workflowInput.dryRun).toBe(true);
  });

  it("without --dry-run, no dryRun key is injected", () => {
    const raw = JSON.parse('{"issueIdentifier":"ISS-1"}');
    const validated = validateRuntimeInput(undefined, raw);
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error("unreachable");
    const workflowInput = mergeDryRunIntoInput(validated.value, false);
    expect(workflowInput).toEqual({ issueIdentifier: "ISS-1" });
    expect("dryRun" in workflowInput).toBe(false);
  });
});
