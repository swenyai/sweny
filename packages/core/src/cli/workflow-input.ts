/**
 * Small, side-effect-free helpers for building the `workflowInput` bag that
 * `sweny workflow run` hands to `execute()`.
 *
 * Deliberately NOT in main.ts: main.ts ends with a top-level
 * `await program.parseAsync()` (see bottom of file), so importing it at all
 * triggers full CLI argv parsing as a side effect. That makes main.ts unsafe
 * to `import` from a test. Anything worth unit-testing in isolation lives
 * here instead (same pattern as config.ts / credentials.ts / e2e.ts).
 */

/**
 * Merge the CLI-level `--dry-run` flag into a `--input`-validated workflow
 * input bag.
 *
 * #324: `sweny workflow run <file> --dry-run --input '{...}'` (what the
 * GitHub Action and MCP server both pass) silently dropped `dryRun` before
 * this fix: the `--input` branch built `workflowInput` from the caller's
 * JSON alone, and only the config-derived (no-`--input`) branch merged in
 * `config.dryRun`. The executor's fail-closed dry-run gate (see
 * `advanceFromNode` in executor.ts) reads `input.dryRun` directly, so a
 * dropped flag meant the full workflow, side effects included, ran anyway.
 *
 * Only forces `dryRun` *on*: when `--dry-run` is set it always wins, but a
 * caller-supplied `dryRun: true` already present in the `--input` JSON must
 * never be downgraded just because `--dry-run` was omitted.
 */
export function mergeDryRunIntoInput(
  validatedInput: Record<string, unknown>,
  cliDryRun: boolean,
): Record<string, unknown> {
  if (!cliDryRun) return validatedInput;
  return { ...validatedInput, dryRun: true };
}
