import { describe, it, expect, vi, afterEach } from "vitest";
import { Command } from "commander";
import { registerTriageCommand, registerImplementCommand, parseCliInputs } from "./config.js";
import { DEPRECATED_FLAGS, deprecatedFlagName, deprecationWarning } from "./deprecated-flags.js";

// The 12 flags #528 removed and swenyai/triage still passes.
const REMOVED_BY_528 = [
  "--cache-dir",
  "--cache-ttl",
  "--no-cache",
  "--output-dir",
  "--service-map-path",
  "--gitlab-base-url",
  "--linear-team-id",
  "--linear-bug-label-id",
  "--linear-triage-label-id",
  "--linear-state-backlog",
  "--linear-state-in-progress",
  "--linear-state-peer-review",
];

// Flags that implement had before #528 (the rest were triage only).
const IMPLEMENT_HAD = ["--output-dir", "--linear-team-id", "--linear-state-in-progress", "--linear-state-peer-review"];

const commands = {
  triage: { register: registerTriageCommand, args: [] as string[] },
  implement: { register: registerImplementCommand, args: ["ENG-1"] },
};

/** A program whose action is a no-op, with commander errors thrown instead of exiting. */
function build(name: "triage" | "implement") {
  const program = new Command();
  program.exitOverride().configureOutput({ writeErr: () => {}, writeOut: () => {} });
  const cmd = commands[name].register(program);
  const seen: Record<string, unknown>[] = [];
  cmd.exitOverride().configureOutput({ writeErr: () => {}, writeOut: () => {} });
  cmd.action((...actionArgs: unknown[]) => {
    seen.push(actionArgs[actionArgs.length - 2] as Record<string, unknown>);
  });
  return { program, cmd, seen };
}

function sampleArgs(spec: string): string[] {
  const name = deprecatedFlagName(spec);
  return spec.includes("<") ? [name, "x"] : [name];
}

function expectedFor(name: "triage" | "implement") {
  return DEPRECATED_FLAGS.filter((d) => d.commands.includes(name));
}

afterEach(() => vi.restoreAllMocks());

describe("deprecated flags table", () => {
  it("covers every flag #528 removed, exactly once", () => {
    const names = DEPRECATED_FLAGS.map((d) => deprecatedFlagName(d.flag));
    expect([...names].sort()).toEqual([...REMOVED_BY_528].sort());
  });

  it("scopes each flag to the commands that had it", () => {
    const onImplement = expectedFor("implement").map((d) => deprecatedFlagName(d.flag));
    expect([...onImplement].sort()).toEqual([...IMPLEMENT_HAD].sort());
    expect(expectedFor("triage")).toHaveLength(REMOVED_BY_528.length);
  });
});

for (const name of ["triage", "implement"] as const) {
  describe(`sweny ${name}: deprecated flags`, () => {
    for (const d of expectedFor(name)) {
      const flag = deprecatedFlagName(d.flag);

      it(`${flag} is accepted, warns once, and is hidden from --help`, async () => {
        const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const { program, cmd, seen } = build(name);

        await program.parseAsync(["node", "sweny", name, ...commands[name].args, ...sampleArgs(d.flag)]);

        expect(seen).toHaveLength(1);
        const warnings = write.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("deprecated"));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(flag);
        expect(warnings[0]).toMatch(/no effect/);
        expect(warnings[0]).toMatch(/future minor version/);
        expect(cmd.helpInformation()).not.toContain(flag);
      });
    }

    it("does not warn when no deprecated flag is passed", async () => {
      const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const { program } = build(name);
      await program.parseAsync(["node", "sweny", name, ...commands[name].args, "--dry-run"]);
      expect(write.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("deprecated"))).toEqual([]);
    });

    it("prints one warning for several flags, naming each", async () => {
      const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const { program } = build(name);
      const used = expectedFor(name);
      await program.parseAsync([
        "node",
        "sweny",
        name,
        ...commands[name].args,
        ...used.flatMap((d) => sampleArgs(d.flag)),
      ]);
      const warnings = write.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("deprecated"));
      expect(warnings).toHaveLength(1);
      for (const d of used) expect(warnings[0]).toContain(deprecatedFlagName(d.flag));
    });

    it("changes no behavior: parsed config is identical with and without the flags", async () => {
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const used = expectedFor(name);

      const without = build(name);
      await without.program.parseAsync(["node", "sweny", name, ...commands[name].args]);
      const withFlags = build(name);
      await withFlags.program.parseAsync([
        "node",
        "sweny",
        name,
        ...commands[name].args,
        ...used.flatMap((d) => sampleArgs(d.flag)),
      ]);

      expect(parseCliInputs(withFlags.seen[0], {})).toEqual(parseCliInputs(without.seen[0], {}));
    });
  });
}

describe("flags that were never deprecated stay rejected", () => {
  it("an unknown flag is still an unknown option", async () => {
    const { program } = build("triage");
    await expect(program.parseAsync(["node", "sweny", "triage", "--not-a-flag"])).rejects.toThrow(/unknown option/);
  });

  it("a deprecated triage-only flag is still unknown on implement", async () => {
    const { program } = build("implement");
    await expect(program.parseAsync(["node", "sweny", "implement", "ENG-1", "--cache-dir", "x"])).rejects.toThrow(
      /unknown option/,
    );
  });
});

describe("deprecationWarning grammar", () => {
  it("one flag: is deprecated and has no effect", () => {
    expect(deprecationWarning(["--a"])).toBe(
      "warning: --a is deprecated and has no effect and will be removed in a future minor version.\n",
    );
  });

  it("several flags: are deprecated and have no effect", () => {
    expect(deprecationWarning(["--a", "--b"])).toBe(
      "warning: --a, --b are deprecated and have no effect and will be removed in a future minor version.\n",
    );
  });
});
