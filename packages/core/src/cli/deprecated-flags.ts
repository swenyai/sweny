import { Option, type Command } from "commander";

/**
 * CLI flags that sweny parsed but never read, removed in #528 and restored
 * here as deprecated no-ops so existing callers (the swenyai/triage action
 * passes most of them) keep working through a deprecation period.
 *
 * Each one is accepted, hidden from `--help`, changes nothing, and prints one
 * stderr warning per run. This table is the only place the list lives;
 * `registerDeprecatedFlags` is the only place it is wired in, once per command.
 *
 * Env vars and `.sweny.yml` keys for the same settings are not parsed at all
 * and are never rejected, so they need no handling.
 *
 * Remove an entry (and its command wiring) in a minor release after the
 * deprecation period; the docs-cloud-positioning test keeps these out of
 * `--help` and out of the supported-option docs tables.
 */
export interface DeprecatedFlag {
  /** Commander flag spec, e.g. "--cache-dir <path>". */
  flag: string;
  /** Commands that accepted this flag before it was removed. */
  commands: readonly string[];
  /** Why it has no effect (kept for maintainers; not printed). */
  note: string;
}

const TRIAGE_AND_IMPLEMENT = ["triage", "implement"] as const;
const TRIAGE_ONLY = ["triage"] as const;

export const DEPRECATED_FLAGS: readonly DeprecatedFlag[] = [
  { flag: "--cache-dir <path>", commands: TRIAGE_ONLY, note: "no step cache exists" },
  { flag: "--cache-ttl <seconds>", commands: TRIAGE_ONLY, note: "no step cache exists" },
  { flag: "--no-cache", commands: TRIAGE_ONLY, note: "no step cache exists" },
  { flag: "--output-dir <path>", commands: TRIAGE_AND_IMPLEMENT, note: "file providers do not read it" },
  { flag: "--service-map-path <path>", commands: TRIAGE_ONLY, note: "service maps are not read" },
  { flag: "--gitlab-base-url <url>", commands: TRIAGE_ONLY, note: "the GitLab provider reads GITLAB_URL" },
  { flag: "--linear-team-id <id>", commands: TRIAGE_AND_IMPLEMENT, note: "the agent gets team ids from the node" },
  { flag: "--linear-bug-label-id <id>", commands: TRIAGE_ONLY, note: "never read" },
  { flag: "--linear-triage-label-id <id>", commands: TRIAGE_ONLY, note: "never read" },
  { flag: "--linear-state-backlog <name>", commands: TRIAGE_ONLY, note: "never read" },
  { flag: "--linear-state-in-progress <name>", commands: TRIAGE_AND_IMPLEMENT, note: "never read" },
  { flag: "--linear-state-peer-review <name>", commands: TRIAGE_AND_IMPLEMENT, note: "never read" },
];

/** `--cache-dir <path>` -> `--cache-dir`. */
export function deprecatedFlagName(spec: string): string {
  return spec.split(/[ ,]/)[0];
}

export function deprecationWarning(flags: readonly string[]): string {
  const list = flags.join(", ");
  const subject = flags.length === 1 ? `${list} is deprecated` : `${list} are deprecated`;
  return `warning: ${subject}, has no effect and will be removed in a future minor version.\n`;
}

/**
 * Accept every deprecated flag that `cmd` used to have. Hidden from help, no
 * effect, and exactly one stderr warning per run naming the flags that were
 * passed.
 */
export function registerDeprecatedFlags(cmd: Command): Command {
  const options = DEPRECATED_FLAGS.filter((d) => d.commands.includes(cmd.name())).map((d) =>
    new Option(d.flag).hideHelp(),
  );
  for (const option of options) cmd.addOption(option);

  cmd.hook("preAction", (_thisCommand, actionCommand) => {
    const used = options
      .filter((o) => actionCommand.getOptionValueSource(o.attributeName()) === "cli")
      .map((o) => o.long as string);
    if (used.length > 0) process.stderr.write(deprecationWarning(used));
  });
  return cmd;
}
