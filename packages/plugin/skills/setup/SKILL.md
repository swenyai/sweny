---
name: setup
description: Create standard SWEny label set in your issue tracker (Linear or GitHub). Run after init to prepare your tracker for triage.
disable-model-invocation: true
allowed-tools: Bash
argument-hint: <linear|github>
---

# SWEny Setup

Create the standard SWEny label set in your issue tracker. This creates labels that SWEny uses to categorize and track issues it creates during triage.

## Usage

For Linear:

```bash
sweny setup linear
```

For GitHub:

```bash
sweny setup github
```

If the user provided an argument, use it:

```bash
sweny setup $ARGUMENTS
```

If no argument was provided, check `.sweny.yml` to determine the issue tracker and suggest the right command.

## Labels created

- **Signal labels:** agent-needs-input, agent-error, human-only, needs-review
- **Work-type labels:** triage, feature, optimization, research, support, spec, task, bug
- **Parent group:** agent (with work-type children)

The command outputs resolved label IDs that can be pasted into `.sweny.yml` for configuration.
