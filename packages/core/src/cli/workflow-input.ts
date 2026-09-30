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

/**
 * Parse `--timeout` / `--max-steps` for `sweny workflow run`. Throws a clear
 * error on non-numeric or out-of-range values instead of silently falling
 * back to a default (which hid typos like `--timeout 15m`).
 *
 * - `--timeout <ms>`: whole-run wall-clock budget in ms. `0` means no
 *   wall-clock budget (returned as `0`). Absent returns `defaultTimeoutMs`.
 * - `--max-steps <n>`: positive integer. Absent returns `undefined` (the
 *   executor's own default applies).
 */
export function parseRunBudgetFlags(
  timeout: string | undefined,
  maxSteps: string | undefined,
  defaultTimeoutMs: number,
): { timeoutMs: number; maxSteps: number | undefined } {
  const parse = (raw: string, flag: string, min: number): number => {
    const t = raw.trim();
    const n = t === "" ? Number.NaN : Number(t);
    if (!Number.isInteger(n) || n < min) {
      throw new Error(
        `${flag} must be ${min === 0 ? "a non-negative" : "a positive"} integer, got "${raw}"` +
          (flag === "--timeout" ? " (milliseconds; 0 disables the wall-clock budget)" : ""),
      );
    }
    return n;
  };
  return {
    timeoutMs: timeout === undefined ? defaultTimeoutMs : parse(timeout, "--timeout", 0),
    maxSteps: maxSteps === undefined ? undefined : parse(maxSteps, "--max-steps", 1),
  };
}
