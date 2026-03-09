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

This policy covers the SWEny monorepo: the GitHub Action, `@sweny-ai/providers`, `@sweny-ai/agent`, and the sweny.ai website.

## Credential Handling

SWEny never stores credentials in code. All secrets are read from environment variables or secret managers at runtime. If you believe a credential has been exposed, rotate it immediately and notify us.

## Open-Source Worker and Audit Path

The `packages/worker` binary is open source so customers can audit every line of code that executes their jobs. Build reproducibility is maintained via pinned base images and `npm ci --frozen-lockfile`.

To verify that the worker running in production matches the published source:

1. Check the Docker image SHA256 on the job detail page (or via `GET /orgs/:orgId/jobs/:jobId/attestation` on Enterprise).
2. Compare against the published image digest on the GitHub Container Registry page for the matching release tag.
3. Reproduce the build locally with `packages/worker/verify-build.sh <image> <tag>` and confirm the manifest digest matches.

The audit trail from source commit → Docker image → running job is maintained in the release pipeline. Enterprise customers additionally receive a signed AWS Nitro attestation document for each job.
