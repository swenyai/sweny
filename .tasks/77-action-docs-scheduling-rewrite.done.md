# Task 77: Rewrite action/scheduling.md for multi-repo architecture

## Problem

`packages/web/src/content/docs/action/scheduling.md` has ~7 code blocks all using `swenyai/sweny@v5` with triage-specific inputs (`dd-api-key`, `dd-app-key`, `time-range`, `dry-run`, `service-filter`, `linear-issue`, `additional-instructions`). These should use `swenyai/triage@v1`.

## What to change

### Triage scheduling examples (lines 35, 55, 130, 248)
Change `swenyai/sweny@v5` to `swenyai/triage@v1` in all cron/dispatch examples that use observability inputs.

### Implement examples (lines 169, 202, 280)
Change `swenyai/sweny@v5` to `swenyai/triage@v1` — the implement workflow with `linear-issue` input is also on the triage action.

### Intro text (line 6)
Current: "SWEny becomes most powerful when it runs on autopilot..."
This is fine — scheduling applies to all actions. But update any language that assumes only triage.

### "Multiple workflows in one repo" section (lines 220+)
Update both the triage and implement examples to use `swenyai/triage@v1`.

## File

`packages/web/src/content/docs/action/scheduling.md`

## Validation

After editing, no `swenyai/sweny@v5` should appear with triage-specific inputs.
