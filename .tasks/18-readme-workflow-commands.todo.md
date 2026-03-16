# Task 18 — README: document `sweny workflow` commands

## Goal

The `sweny workflow` subcommand (list, validate, run, export) was added in
recent sessions but is completely undocumented in the README. Open source
users building custom workflows have no way to discover these commands.
This task documents them prominently.

## Context

The CLI already implements (all tested and working):
- `sweny workflow list [--json]` — lists registered built-in step types
- `sweny workflow validate <file> [--json]` — validates a YAML/JSON workflow
  file; exits 0/1; reports UNREACHABLE_STEP, UNKNOWN_TARGET, MISSING_INITIAL
- `sweny workflow run <file> [--dry-run] [--steps <module>]` — runs a custom
  workflow file; `--steps` loads a module that registers custom step types
- `sweny workflow export <name>` — prints triage or implement workflow as YAML
  with schema header

The README has a `## @sweny-ai/cli` section (line ~438) with "Quick start" and
"Config file" subsections. The workflow commands should be added in a new
`### Custom workflows` subsection here.

## What to write

A clear "Custom workflows" subsection covering:

1. **Exporting a built-in as a starting point:**
   ```bash
   sweny workflow export triage > my-workflow.yaml
   ```

2. **Validating your workflow file:**
   ```bash
   sweny workflow validate my-workflow.yaml
   # ✓ my-workflow.yaml is valid
   # or: exits 1 with error details
   ```

3. **Running a custom workflow:**
   ```bash
   sweny workflow run my-workflow.yaml
   ```

4. **Browsing available step types:**
   ```bash
   sweny workflow list
   sweny workflow list --json  # machine-readable
   ```

5. **Using custom step types** (`--steps` flag) with a short code example
   showing `registerStepType(...)` and then `--steps ./my-steps.js`.

Keep it concise — this is a reference section, not a tutorial. Show the
commands, show the output format, done. Link to `docs/recipe-authoring.md`
for the full guide.

## Also fix in the README

The Studio section (line ~561) says `RecipeDefinition` — this type was renamed
to `WorkflowDefinition`. Also says `RecipeViewer` (should be `StandaloneViewer`
based on the actual export). Fix these while you're in the file.

## Changeset

None needed — README is not a published package artifact.

## Done when

- [ ] `### Custom workflows` subsection added under `## @sweny-ai/cli`
- [ ] All 4 workflow subcommands documented with example commands
- [ ] `--steps` flag documented with code snippet
- [ ] Studio section updated: `RecipeDefinition` → `WorkflowDefinition`,
      `RecipeViewer` → `StandaloneViewer`
- [ ] No new dependencies or code changes — docs only
