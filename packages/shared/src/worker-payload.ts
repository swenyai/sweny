/**
 * WorkerJobPayload — the public interface between the sweny.ai platform and the
 * open-source worker binary.
 *
 * This type is intentionally minimal. It contains no billing info, no internal
 * org state, and no platform secrets. Credentials are delivered encrypted and
 * are only decrypted inside the worker process after fetching the bundle
 * encryption key (BEK) from the internal API using the one-time job token.
 *
 * Rules for adding fields:
 *   OK: identifiers, repo coordinates, job type, structured config
 *   NOT OK: plaintext credentials, billing state, internal platform IDs that
 *            would couple the open worker to closed platform internals
 */
export interface WorkerJobPayload {
  /** Unique job identifier (UUID). Used to fetch secrets and submit the outcome. */
  jobId: string;

  /** Organization identifier. Included for structured logging; no auth use. */
  orgId: string;

  /**
   * One-time token that authenticates the worker to the internal API.
   * Used to fetch the bundle encryption key (BEK) and submit the job outcome.
   * Issued at dispatch time, consumed on first use.
   */
  jobToken: string;

  /**
   * AES-256-GCM encrypted bundle of org credentials.
   * JSON map of key → "iv:authTag:ciphertext" (hex-encoded).
   * The bundle encryption key (BEK) is NOT included here — the worker fetches
   * it from the internal API using jobToken above.
   */
  encryptedBundle: string;

  /** Discriminates between recipe types. */
  jobType: "triage" | "implement";

  /** GitHub repository owner (org or user). */
  repoOwner: string;

  /** GitHub repository name. */
  repoName: string;

  /** Default branch to clone. */
  defaultBranch: string;

  /**
   * Per-job recipe configuration overrides, merged with defaults in the worker.
   * Kept as an open Record so the worker package does not need to import
   * recipe-specific config types.
   */
  config: Record<string, unknown>;
}
