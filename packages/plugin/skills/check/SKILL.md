---
description: Verify SWEny provider credentials and connectivity. Run to diagnose configuration issues before running workflows.
allowed-tools: Bash
---

# SWEny Check

Verify that all configured provider credentials are valid and connectivity works. Tests each provider (Anthropic, Datadog, Sentry, Linear, GitHub, etc.) and reports status.

## Usage

```bash
sweny check
```

## Output

Each provider shows one of:
- **ok** — credentials valid, connection successful
- **fail** — credentials invalid or connection failed (details shown)
- **skip** — provider not configured

If any provider shows **fail**, the user needs to update their `.env` or environment variables before running workflows.

This is a quick command (a few seconds). Run it before `/sweny:triage` or `/sweny:implement` if you suspect configuration issues.
