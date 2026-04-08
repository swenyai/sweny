# Task 79: Rewrite action/service-map.md for multi-repo architecture

## Problem

`packages/web/src/content/docs/action/service-map.md` has 5 code blocks using `swenyai/sweny@v5` with triage-specific inputs (`dd-api-key`, `dd-app-key`, `service-filter`, `observability-provider`, `sentry-*`, `bot-token`, `service-map-path`). Service maps are a triage feature — all examples should use `swenyai/triage@v1`.

## What to change

### All code blocks with action references

Replace `swenyai/sweny@v5` with `swenyai/triage@v1` in these locations:
- Line 76: `service-filter` example
- Line 133: Multi-repo API gateway example
- Line 179: Multi-repo billing example
- Line 194: Cross-repo dispatch example
- Line 209: Custom service map path example

### Intro text

Add a note that service maps are a feature of `swenyai/triage@v1`.

## File

`packages/web/src/content/docs/action/service-map.md`

## Validation

No `swenyai/sweny@v5` references should remain in this file. All action references should be `swenyai/triage@v1`.
