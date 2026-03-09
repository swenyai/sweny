# What's Open Source

## Open (sweny repo)

- **engine** — recipe runner, step execution, cycle detection
- **providers** — all integrations (Datadog, Linear, GitHub, etc.)
- **action** — GitHub Action wrapper
- **cli** — `sweny` CLI for local/CI use
- **agent** — Claude Code subprocess management

## Open (sweny-worker, coming soon)

- **worker** — the cloud job executor (queue consumer + runRecipe)
  The worker is just the open-source engine running inside a queue.
  Opening it lets customers audit and verify what runs on their data.

## Closed (cloud repo — sweny.ai platform)

- **API** — multi-tenant orchestration, billing, auth, org management
- **UI** — dashboard, settings, job history
- **Infrastructure** — deployment, scaling, monitoring

## Why this split?

The value of sweny.ai cloud is NOT in the code that executes jobs (that's open).
The value is in: managed execution, team collaboration, result history, integrations
UI, compliance features (BYOK, TEE), and operational reliability.

You can run the engine yourself for free. You pay us to manage it at scale,
keep it running, and give your team visibility.

## Job Execution Flow

When sweny.ai cloud runs a job:

1. The API dispatches a `WorkerJobPayload` onto a BullMQ queue
2. The worker (open-source) picks up the job
3. The worker fetches the bundle encryption key (BEK) from the internal API using a one-time job token
4. The worker decrypts credentials in memory, clones the repo, and runs `runRecipe()` from `@sweny-ai/engine`
5. The worker submits a structured `JobOutcome` back to the internal API
6. The API persists job metadata and notifies the UI

Steps 3–5 are the open-source worker. Steps 1, 2, and 6 are the closed platform.
No proprietary business logic lives in the worker — it is pure engine orchestration.

## Audit Path

Customers who want to verify what ran on their data can:

1. Check the open-source worker source at `packages/worker/` in this repo
2. Compare the published Docker image digest against the build attestation in GitHub Releases
3. Use `packages/worker/verify-build.sh` to verify a specific image was built from a known commit
4. Run the worker themselves in their own VPC (BYO Worker tier)

The `WorkerJobPayload` type (in `packages/shared/src/worker-payload.ts`) defines the exact
public interface: no billing info, no internal org state, no platform secrets cross this boundary.
