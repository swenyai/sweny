# Self-Hosted Worker

> **Status:** This documents the managed execution model from
> [aws-cloud](https://github.com/swenyai/aws-cloud). It is not live in the current
> cloud product (cloud.sweny.ai), which is an analytics dashboard. This architecture
> may be revisited in the future.

The sweny.ai worker is open source. This means you can run the exact same binary
that the managed execution platform uses, but inside your own infrastructure —
pointing at the orchestration API for job dispatch and result storage.

This is the **BYO Worker** tier: the platform handles orchestration, scheduling, the
dashboard, and result history. You handle compute.

---

## Why run your own worker?

- **Audit**: read the source, verify the binary matches via build attestation
- **Data residency**: source code is cloned and processed entirely within your VPC
- **Cost control**: run on your own compute budget
- **Compliance**: some regulated environments require code execution to stay on-prem

---

## Prerequisites

- Docker (or any OCI-compatible runtime)
- Network access to `api.sweny.ai` from your worker host
- A **Worker API Token** from your org settings (Settings → Worker → Generate Token)

---

## Quick Start

### 1. Get a Worker API Token

In the sweny.ai dashboard: **Settings → Worker → Generate Token**

Copy the token — you will not be able to see it again.

### 2. Run the worker

```bash
docker run \
  -e REDIS_URL=rediss://worker:<token>@queue.sweny.ai:6380 \
  -e INTERNAL_API_URL=https://api.sweny.ai \
  swenyai/worker:latest
```

The `REDIS_URL` and `INTERNAL_API_URL` values are shown in the dashboard after
generating your worker token.

### 3. Verify the worker is connected

In the dashboard: **Settings → Worker** — your worker should appear as "Connected"
within 30 seconds of starting.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `REDIS_URL` | Yes | BullMQ queue URL (provided by sweny.ai or your own Redis) |
| `INTERNAL_API_URL` | Yes | sweny.ai internal API base URL |

The worker has no other required configuration. All job-specific credentials are
delivered encrypted in the job payload and decrypted in memory — they are never
stored in the container or its environment.

---

## Using Your Own Queue

If you need the job queue to stay inside your VPC as well, contact us about the
Enterprise tier. This allows you to run both the queue (Redis/Valkey) and the
worker in your own infrastructure, with sweny.ai only receiving structured job
outcomes (no credentials, no source code).

---

## Build Attestation

Every published worker image has a corresponding attestation in
[GitHub Releases](https://github.com/swenyai/sweny/releases) that includes:

- The git commit the image was built from
- The Docker image SHA256 digest
- An SBOM (Software Bill of Materials)

To verify a specific image:

```bash
cd packages/worker
./verify-build.sh swenyai/worker:v1.2.3 <commit-sha>
```

To rebuild from source and compare digests:

```bash
git checkout <commit-sha>
cd packages/worker
docker buildx build --platform linux/amd64 -t swenyai/worker:local .
```

---

## Architecture

The worker is a thin queue consumer that wraps the open-source engine:

```
BullMQ queue
    │
    ▼
Worker (this package)
    │  1. fetch BEK from internal API (one-time job token)
    │  2. decrypt credential bundle in memory
    │  3. clone repo to tmpdir
    │  4. runRecipe() — @sweny-ai/engine
    │  5. rm -rf tmpdir
    │  6. POST outcome to internal API
    ▼
sweny.ai API (stores job metadata, notifies UI)
```

No database connection is required. The worker communicates with the platform
only through the narrow internal API using the one-time job token from the payload.

See [ARCHITECTURE.md](../ARCHITECTURE.md) for the full open-core boundary description.
