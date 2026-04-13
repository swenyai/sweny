# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in SWEny, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email **security@sweny.ai** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge your report within 48 hours and aim to release a fix within 7 days for critical issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | Yes       |

## Scope

This policy covers the SWEny monorepo: the CLI (`@sweny-ai/core`), GitHub Action (`@sweny-ai/action`), Studio (`@sweny-ai/studio`), MCP server (`@sweny-ai/mcp`), and the docs/spec sites.

## Credential Handling

SWEny never stores credentials in code. All secrets are read from environment variables at runtime. If you believe a credential has been exposed, rotate it immediately and notify us.

## Execution Model

SWEny runs entirely in your environment — your terminal, your CI runner, your compute. The cloud dashboard ([cloud.sweny.ai](https://cloud.sweny.ai)) receives only structured metadata (run status, duration, recommendations) when explicitly opted in via `SWENY_CLOUD_TOKEN`. No source code, diffs, or secrets are ever sent.
