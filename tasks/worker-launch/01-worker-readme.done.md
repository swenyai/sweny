# Task 01 — Write `packages/worker/README.md`

## Goal

Create a clear, self-contained README for the open-source `@sweny-ai/worker` package
that lets a developer spin up a self-hosted SWEny worker (BYO Worker tier) without
needing to ask questions.

## Background

`packages/worker/` is the open-core BullMQ job executor. It runs alongside the sweny.ai
cloud platform: the platform enqueues jobs to a Redis queue, and the customer's worker
picks them up, decrypts credentials, clones the repo, and runs the engine. This lets
customers audit what runs on their data and optionally run the worker in their own VPC.

Key files already written:
- `src/index.ts` — BullMQ Worker entry point
- `src/runner.ts` — runJob (fetch BEK → decrypt → clone → runRecipe → report result)
- `src/providers.ts` — hydrateProviders from decrypted credential map
- `src/crypto.ts` — AES-256-GCM decryptBundle
- `src/env.ts` — validates REDIS_URL, INTERNAL_API_URL, QUEUE_NAME, CONCURRENCY, CODING_AGENT
- `Dockerfile` — expects `dist/index.js`, runs as non-root `sweny` user
- `verify-build.sh` — cross-references Docker image digest against GitHub Release attestation

## Required env vars (from src/env.ts)

| Var | Required | Default | Description |
|-----|----------|---------|-------------|
| `REDIS_URL` | ✅ | — | BullMQ queue connection (`redis://...`) |
| `INTERNAL_API_URL` | ✅ | — | sweny.ai internal API (`https://api.sweny.ai`) |
| `QUEUE_NAME` | — | `sweny-jobs` | BullMQ queue name (must match platform config) |
| `CONCURRENCY` | — | `1` | Jobs processed in parallel (keep at 1 — runner uses process.chdir) |
| `CODING_AGENT` | — | `claude` | `claude` \| `codex` \| `gemini` |

Additionally, the coding agent CLI must be installed in the container:
- `claude` → `npm install -g @anthropic-ai/claude-code` (done automatically on startup)
- `codex` → `npm install -g @openai/codex`
- `gemini` → `npm install -g @google/gemini-cli`

## What the README must cover

1. **What is the BYO Worker?** — 2-3 sentence intro (self-host, audit, VPC isolation)
2. **Prerequisites** — Docker, Redis, sweny.ai Pro/Team plan with BYO Worker enabled
3. **Quick start with Docker**
   ```sh
   docker pull ghcr.io/swenyai/worker:latest
   docker run \
     -e REDIS_URL=redis://your-redis:6379 \
     -e INTERNAL_API_URL=https://api.sweny.ai \
     ghcr.io/swenyai/worker:latest
   ```
4. **Docker Compose example** — worker + redis in a compose file
5. **Environment variable reference** — the table above
6. **Coding agent selection** — how CODING_AGENT works, which agent CLIs are needed
7. **Auditing / verify-build** — point to `verify-build.sh`, explain what it does
8. **Building from source**
   ```sh
   npm ci
   npm run build --workspace=packages/worker
   node packages/worker/dist/index.js
   ```
9. **How it connects to sweny.ai** — brief explanation of the BEK flow (no credentials
   in the queue payload; worker fetches the one-time key from INTERNAL_API_URL)

## Acceptance criteria

- [ ] README.md exists at `packages/worker/README.md`
- [ ] Docker pull + run command is copy-pasteable and correct
- [ ] All env vars documented with required/optional/default
- [ ] verify-build.sh referenced for audit users
- [ ] Tone is clear and concise — no marketing fluff
