# @sweny-ai/worker

The open-source SWEny job executor. Run this in your own infrastructure to audit exactly what runs on your data, or to keep sensitive code clones inside your VPC.

The sweny.ai platform enqueues jobs onto a Redis queue. This worker picks them up, fetches decryption keys from the platform API, decrypts credentials in memory, clones the repo, and runs the SWEny engine — then reports the outcome back. No plaintext credentials ever sit in the queue.

---

## Quick Start

```sh
docker pull ghcr.io/swenyai/worker:latest

docker run \
  -e REDIS_URL=redis://your-redis:6379 \
  -e INTERNAL_API_URL=https://api.sweny.ai \
  ghcr.io/swenyai/worker:latest
```

That's it. The worker installs the Claude Code CLI on first startup, then waits for jobs.

---

## Prerequisites

- Docker (or Node 22+ to run from source)
- A Redis instance reachable from this host
- A sweny.ai Pro or Team plan with BYO Worker enabled
- Your Redis URL configured in sweny.ai org settings so the platform enqueues to it

---

## Docker Compose

```yaml
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped

  sweny-worker:
    image: ghcr.io/swenyai/worker:latest
    restart: unless-stopped
    environment:
      REDIS_URL: redis://redis:6379
      INTERNAL_API_URL: https://api.sweny.ai
      CODING_AGENT: claude        # claude | codex | gemini
      CONCURRENCY: "1"            # keep at 1 — runner uses process.chdir
    depends_on: [redis]
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | ✅ | — | BullMQ queue connection string (`redis://host:port`) |
| `INTERNAL_API_URL` | ✅ | — | sweny.ai API base URL (`https://api.sweny.ai`) |
| `QUEUE_NAME` | — | `sweny-jobs` | BullMQ queue name — must match the platform setting |
| `CONCURRENCY` | — | `1` | Jobs processed in parallel. Keep at `1`: the runner uses `process.chdir` which is process-global |
| `CODING_AGENT` | — | `claude` | Which coding agent CLI to use: `claude`, `codex`, or `gemini` |

---

## Coding Agent

The worker spawns a coding agent CLI subprocess for investigation and implementation steps.

| `CODING_AGENT` | CLI package | Auto-installed? |
|---------------|-------------|-----------------|
| `claude` (default) | `@anthropic-ai/claude-code` | ✅ Yes, on startup |
| `codex` | `@openai/codex` | ❌ Pre-install: `npm i -g @openai/codex` |
| `gemini` | `@google/gemini-cli` | ❌ Pre-install: `npm i -g @google/gemini-cli` |

The coding agent needs credentials at job runtime — those are passed via the encrypted credential bundle, not the worker environment. You don't set `ANTHROPIC_API_KEY` on the worker itself; the customer's credentials come through the platform.

---

## How Credential Security Works

1. **Platform encrypts credentials** — your org's API keys are AES-256-GCM encrypted in the platform DB
2. **Job payload contains only ciphertext** — the queue message never has plaintext secrets
3. **Worker fetches the one-time decryption key** — using a short-lived `jobToken` from `INTERNAL_API_URL`; the key is deleted after first fetch (replay protection)
4. **Credentials decrypted in memory** — only inside this process, never written to disk
5. **Git token uses credential-store** — `GITHUB_TOKEN` goes to a `0600` file, never into a subprocess environment or argv

---

## Auditing

Verify that a Docker image was built from a specific commit:

```sh
./verify-build.sh ghcr.io/swenyai/worker:v1.2.3 abc1234
```

This script fetches the image manifest digest and prints the GitHub Release URL where the canonical mapping, SBOM, and build provenance are published.

To rebuild from source and compare:

```sh
git checkout <commit>
cd packages/worker
docker buildx build --platform linux/amd64 --load -t swenyai/worker:local .
```

---

## Running from Source

```sh
# From repo root
npm ci
npm run build --workspace=packages/worker

# Set required env vars
export REDIS_URL=redis://localhost:6379
export INTERNAL_API_URL=https://api.sweny.ai

node packages/worker/dist/index.js
```

Or in dev mode (tsx, no build step):

```sh
cd packages/worker
REDIS_URL=redis://localhost:6379 INTERNAL_API_URL=https://api.sweny.ai npx tsx src/index.ts
```

---

## Running Tests

```sh
npm test --workspace=packages/worker
```

26 tests covering AES-256-GCM decryption, job dispatch (triage + implement), API call sequence, credential-store git clone pattern, and workDir cleanup.
