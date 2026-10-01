/**
 * Shared fast-check settings for the invariant suites.
 *
 * The seed is fixed so CI is deterministic, and fast-check prints it (plus the
 * counterexample and the replay path) on any failure. To explore other inputs
 * locally, run with `PROPERTY_SEED=<n>` (and `PROPERTY_RUNS=<n>`).
 */
export const SEED = Number(process.env.PROPERTY_SEED ?? 20260930);

/** Bounded run count: every property here stays well under a second. */
export function params(numRuns = 100): { seed: number; numRuns: number } {
  const runs = Number(process.env.PROPERTY_RUNS ?? numRuns);
  return { seed: SEED, numRuns: runs };
}
