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

This policy covers the SWEny monorepo: the GitHub Action, `@sweny/providers`, `@sweny/agent`, and the sweny.ai website.

## Credential Handling

SWEny never stores credentials in code. All secrets are read from environment variables or secret managers at runtime. If you believe a credential has been exposed, rotate it immediately and notify us.
