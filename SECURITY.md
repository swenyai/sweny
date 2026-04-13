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

## Open-Source Worker Audit Path (aws-cloud — not yet live)

> The managed execution model described below is from
> [aws-cloud](https://github.com/swenyai/aws-cloud) and is not part of the current
> cloud product. It may be revisited in the future.

The worker binary is open source so customers can audit every line of code that executes their jobs. Build reproducibility is maintained via pinned base images and `npm ci --frozen-lockfile`.

To verify that a worker image matches the published source:

1. Check the Docker image SHA256 on the job detail page (or via `GET /orgs/:orgId/jobs/:jobId/attestation` on Enterprise).
2. Compare against the published image digest on the GitHub Container Registry page for the matching release tag.
3. Reproduce the build locally with `verify-build.sh <image> <tag>` and confirm the manifest digest matches.

The audit trail from source commit → Docker image → running job is maintained in the release pipeline. Enterprise customers additionally receive a signed AWS Nitro attestation document for each job.
