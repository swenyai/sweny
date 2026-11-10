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
 *
 * A migration must keep behavior: a file migrated in memory runs exactly as it
 * did. Where a new version changes a default, the migration writes the old
 * default out explicitly, and reports each spot as a {@link MigrationNote}: the
 * loader turns notes into warnings, `sweny workflow upgrade` into comments.
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
  /** Optional, pure: what the author should know about this step's changes to `raw` (its input). */
  notes?: (raw: RawWorkflow) => MigrationNote[];
}

/** One spot a migration made explicit that the author should review. */
export interface MigrationNote {
  /** Path of the key the migration set, in the migrated object (e.g. `["nodes", "post", "permissions"]`). */
  path: (string | number)[];
  /** The node it is about, when there is one. */
  nodeId?: string;
  /** One line `sweny workflow upgrade` writes as a comment above `path`. */
  comment: string;
  /** One line the loader emits when it migrates in memory. Absent: nothing to warn about. */
  warning?: string;
}

/** The spec version this build of sweny reads natively. */
export const CURRENT_SPEC_VERSION = 2;

/**
 * The spec version a workflow object runs as: its `spec_version`, or 1 when
 * absent (a file written before the field, or a workflow built in code that
 * the loader never migrated). Permission defaults and the journal's workflow
 * hash both read this, so resume binds to the version the policy ran under.
 */
export function effectiveSpecVersion(workflow: { spec_version?: string }): number {
  return workflow.spec_version === undefined ? 1 : Number(workflow.spec_version);
}

// ─── v1 -> v2: safe by default (#598) ────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The `access` a raw `permissions` value declares, if any. */
function declaredAccess(p: unknown): unknown {
  if (typeof p === "string") return p;
  return isRecord(p) ? p.access : undefined;
}

function declaresNativeNone(p: unknown): boolean {
  return isRecord(p) && p.native === "none";
}

function skillList(node: Record<string, unknown>): string[] {
  return Array.isArray(node.skills) ? node.skills.filter((s): s is string => typeof s === "string") : [];
}

interface ImplicitAccess {
  id: string;
  /** What v2 must declare for the node to behave as it did in v1. */
  access: "read" | "write";
  /** Path of the key the migration sets. */
  path: (string | number)[];
  skills: string[];
}

/**
 * Nodes whose access spec v1 left to its `write` fallback: no `access` of
 * their own, no `outputs`, and no workflow `access`. Spec v2 reads those as
 * `read`, so the migration declares what each one had.
 *
 * `read` only where it is provably the same: a node with no skills that runs
 * with `native: none` (its own or the workflow's) has no tool at all, so
 * nothing for `write` to unlock. Every other such node keeps `write`, the
 * access it had; the migration never grants more than v1 did.
 */
function implicitAccessNodes(raw: RawWorkflow): ImplicitAccess[] {
  if (declaredAccess(raw.permissions) !== undefined || !isRecord(raw.nodes)) return [];
  const wfNone = declaresNativeNone(raw.permissions);
  const found: ImplicitAccess[] = [];
  for (const [id, node] of Object.entries(raw.nodes)) {
    if (!isRecord(node)) continue;
    if (declaredAccess(node.permissions) !== undefined) continue;
    if (Array.isArray(node.outputs) && node.outputs.length > 0) continue;
    const skills = skillList(node);
    const noTools = skills.length === 0 && (wfNone || declaresNativeNone(node.permissions));
    const path = isRecord(node.permissions) ? ["nodes", id, "permissions", "access"] : ["nodes", id, "permissions"];
    found.push({ id, access: noTools ? "read" : "write", path, skills });
  }
  return found;
}

/** The warning for one node that can write only because nothing limits it. */
export function implicitWriteWarning(nodeId: string): string {
  return (
    `Node "${nodeId}" can write because nothing limits it (spec_version "1" default). ` +
    "Declare permissions or outputs on it, or run `sweny workflow upgrade`."
  );
}

const v1ToV2: Migration = {
  from: 1,
  to: 2,
  description: "safe by default: declare `permissions` on every node that relied on the v1 `write` default",
  migrate: (raw) => {
    const found = implicitAccessNodes(raw);
    if (found.length === 0) return { ...raw };
    const nodes = { ...(raw.nodes as Record<string, Record<string, unknown>>) };
    for (const { id, access } of found) {
      const node = nodes[id];
      nodes[id] = {
        ...node,
        permissions: isRecord(node.permissions) ? { ...node.permissions, access } : access,
      };
    }
    return { ...raw, nodes };
  },
  notes: (raw) =>
    implicitAccessNodes(raw).map(({ id, access, path, skills }) =>
      access === "read"
        ? {
            path,
            nodeId: id,
            comment: "sweny workflow upgrade: read, because this node has no skills and no built-in tools.",
          }
        : {
            path,
            nodeId: id,
            comment:
              `sweny workflow upgrade: write, kept from spec v1 (nothing limited this node; ` +
              (skills.length > 0
                ? `its skills [${skills.join(", ")}] may need their write tools). `
                : "it can use built-in shell and file edit tools). ") +
              "If it only reads, set permissions: read; if it only posts, declare outputs.",
            warning: implicitWriteWarning(id),
          },
    ),
};

/**
 * Ordered registry, one entry per version step.
 * Append only; never edit a shipped migration.
 */
export const MIGRATIONS: readonly Migration[] = [v1ToV2];

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
      /** Notes from the applied migrations, in order. Empty when there are none. */
      notes: MigrationNote[];
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
  const notes: MigrationNote[] = [];
  for (let v = from; v < config.current; v++) {
    const step = config.migrations.find((m) => m.from === v);
    if (!step) {
      return { ok: false, code: "MIGRATION_FAILED", message: `No migration registered from spec_version "${v}".` };
    }
    try {
      if (step.notes) notes.push(...step.notes(current));
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
  return { ok: true, workflow: current, from, to: config.current, declared, applied, notes };
}

/** The single warning the loader emits when it migrated in memory. */
export function migrationWarning(from: number, to: number, filePath?: string): string {
  const target = filePath ? `"${filePath}"` : "<file>";
  return (
    `Workflow uses spec_version "${from}" (current is "${to}"); migrated in memory for this run. ` +
    `Run \`sweny workflow upgrade ${target}\` to update the file.`
  );
}
