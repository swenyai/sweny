/**
 * Workflow spec versioning and migrations.
 *
 * Every workflow file carries an optional top-level `spec_version` (a string
 * holding a positive integer, e.g. "1"). A file without the field is version 1:
 * that is what every file written before the field existed means.
 *
 * Breaking spec changes bump CURRENT_SPEC_VERSION and add one entry to
 * MIGRATIONS: a pure function from the raw (unvalidated) vN object to the raw
 * vN+1 object. The loader applies the chain in memory so old files keep
 * running; `sweny workflow upgrade <file>` writes the result back to disk.
 *
 * Adding a migration: see `__tests__/migrations.test.ts` for the harness
 * (registry validity check plus a chain test to copy).
 */

/** A raw, not-yet-validated workflow object as parsed from YAML or JSON. */
export type RawWorkflow = Record<string, unknown>;

export interface Migration {
  /** Version this migration reads. */
  from: number;
  /** Version it produces. Always `from + 1`. */
  to: number;
  /** One line shown by `sweny workflow upgrade`. */
  description: string;
  /** Pure: must not mutate its input. Returns the next-version object. */
  migrate: (raw: RawWorkflow) => RawWorkflow;
}

/** The spec version this build of sweny reads natively. */
export const CURRENT_SPEC_VERSION = 1;

/**
 * Ordered registry, one entry per version step. Empty while v1 is current.
 * Append only; never edit a shipped migration.
 */
export const MIGRATIONS: readonly Migration[] = [];

export interface MigrationConfig {
  current: number;
  migrations: readonly Migration[];
}

export const DEFAULT_MIGRATION_CONFIG: MigrationConfig = {
  current: CURRENT_SPEC_VERSION,
  migrations: MIGRATIONS,
};

export type MigrateError = {
  code: "INVALID_VERSION" | "TOO_NEW" | "MIGRATION_FAILED";
  message: string;
};

export type MigrateResult =
  | {
      ok: true;
      /** The (possibly migrated) object. `spec_version` is a string when it was declared or migrated. */
      workflow: RawWorkflow;
      /** Version the file declared (1 when absent). */
      from: number;
      /** Version of `workflow` after migration. */
      to: number;
      /** Whether the input declared `spec_version`. */
      declared: boolean;
      /** Migrations applied, in order. Empty when the file is already current. */
      applied: Migration[];
    }
  | ({ ok: false } & MigrateError);

/** Throws if a registry is not an unbroken chain of single steps ending at `current`. */
export function assertRegistryValid(config: MigrationConfig): void {
  const { current, migrations } = config;
  if (!Number.isInteger(current) || current < 1) throw new Error("current spec version must be a positive integer");
  if (migrations.length !== current - 1) {
    throw new Error(`expected ${current - 1} migration(s) to reach v${current}, found ${migrations.length}`);
  }
  migrations.forEach((m, i) => {
    if (m.from !== i + 1 || m.to !== i + 2) {
      throw new Error(`migration #${i} must be v${i + 1} -> v${i + 2}, got v${m.from} -> v${m.to}`);
    }
  });
}

function parseVersion(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return Number(value);
  return null;
}

export function migrateWorkflow(raw: RawWorkflow, config: MigrationConfig = DEFAULT_MIGRATION_CONFIG): MigrateResult {
  const declared = "spec_version" in raw && raw.spec_version !== undefined;
  const from = declared ? parseVersion(raw.spec_version) : 1;
  if (from === null) {
    return {
      ok: false,
      code: "INVALID_VERSION",
      message: `spec_version must be a positive integer string like "1", got ${JSON.stringify(raw.spec_version)}`,
    };
  }
  if (from > config.current) {
    return {
      ok: false,
      code: "TOO_NEW",
      message:
        `This workflow declares spec_version "${from}", but this version of sweny supports up to "${config.current}". ` +
        `Upgrade sweny (run "sweny upgrade", or npm install -g @sweny-ai/core@latest) and try again.`,
    };
  }

  let current: RawWorkflow = declared ? { ...raw, spec_version: String(from) } : raw;
  const applied: Migration[] = [];
  for (let v = from; v < config.current; v++) {
    const step = config.migrations.find((m) => m.from === v);
    if (!step) {
      return { ok: false, code: "MIGRATION_FAILED", message: `No migration registered from spec_version "${v}".` };
    }
    try {
      current = { ...step.migrate(current), spec_version: String(step.to) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        code: "MIGRATION_FAILED",
        message: `Migration from spec_version "${step.from}" to "${step.to}" failed: ${msg}`,
      };
    }
    applied.push(step);
  }
  return { ok: true, workflow: current, from, to: config.current, declared, applied };
}

/** The single warning the loader emits when it migrated in memory. */
export function migrationWarning(from: number, to: number, filePath?: string): string {
  const target = filePath ? `"${filePath}"` : "<file>";
  return (
    `Workflow uses spec_version "${from}" (current is "${to}"); migrated in memory for this run. ` +
    `Run \`sweny workflow upgrade ${target}\` to update the file.`
  );
}
