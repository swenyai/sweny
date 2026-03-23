# Task 04 — Cloud: BYO Worker Dispatch

## Goal

Allow sweny.ai Pro/Team orgs to configure a customer-provided Redis URL so the platform
dispatches jobs to their self-hosted BullMQ worker instead of the internal SQS Lambda worker.

## Repo

`/Users/nate/src/swenyai/cloud` — private cloud service (API + Worker + UI)

## Background

Today the cloud dispatches all jobs via:
- `services/worker/src/queue/producer.ts` — `SQSClient.send(SendMessageCommand(...))`

BYO Worker needs the platform to optionally dispatch to a customer's BullMQ queue instead.
The payload format (`WorkerJobPayload` from `packages/shared/src/worker-payload.ts` in the
sweny repo) is already defined — it's the open-core interface.

## Database changes

Add `byo_redis_url` column to the `repos` or `orgs` table (org-level makes more sense):

```sql
ALTER TABLE orgs ADD COLUMN byo_redis_url text;
```

Drizzle schema file: `packages/shared/src/db/schema.ts` (check actual path).
Create a new migration in `packages/shared/src/migrations/` (check actual pattern).

## API changes

### New endpoint: `PUT /orgs/:orgId/byo-worker`

Request body:
```json
{ "redisUrl": "redis://customer-redis:6379" }
```

- Validate `redisUrl` starts with `redis://` or `rediss://`
- Store in `orgs.byo_redis_url`
- Return `{ ok: true }`

### New endpoint: `GET /orgs/:orgId/byo-worker`

Returns:
```json
{ "configured": true, "redisUrl": "redis://***:6379" }  // mask credentials
```

## Job dispatch changes

`services/api/src/routes/jobs.ts` (or wherever dispatch happens) — after the job row is
inserted, check if `org.byo_redis_url` is set:

```typescript
if (org.byoRedisUrl) {
  // Dispatch to customer BullMQ
  await dispatchToBullMQ(org.byoRedisUrl, workerJobPayload);
} else {
  // Default: dispatch via SQS to internal Lambda worker
  await dispatchViaS QS(internalPayload);
}
```

New file: `services/api/src/queue/byo-dispatch.ts`:
```typescript
import { Queue } from "bullmq";

export async function dispatchToBullMQ(
  redisUrl: string,
  payload: WorkerJobPayload,
  queueName = "sweny-jobs",
): Promise<void> {
  const queue = new Queue(queueName, { connection: { url: redisUrl } });
  await queue.add("job", payload, { removeOnComplete: true, removeOnFail: 100 });
  await queue.close();
}
```

Note: `WorkerJobPayload` is in the open-source sweny repo's `packages/shared/`. The cloud
already imports from `@cloud/shared` for its internal types. The BYO payload uses the open
`WorkerJobPayload` shape — check if it's imported as a subtype or rebuild locally.

## UI changes

In `services/ui/src/` — add a "BYO Worker" settings section to the org settings page:
- Input field for Redis URL
- Save button → `PUT /orgs/:orgId/byo-worker`
- Current status indicator (configured / not configured)
- Link to `packages/worker/README.md` on GitHub

## Dependencies

The API service needs `bullmq` added to its `package.json` (only for the BYO dispatch path).

## Test files to create/update

- `services/api/src/__tests__/byo-worker.test.ts` — test PUT/GET endpoints
- Update job dispatch tests to cover the BYO branch

## Acceptance criteria

- [ ] `orgs.byo_redis_url` column exists in schema + migration
- [ ] `PUT /orgs/:orgId/byo-worker` stores the URL and validates format
- [ ] `GET /orgs/:orgId/byo-worker` returns masked URL + configured status
- [ ] Job dispatch branches on `byoRedisUrl` — BullMQ if set, SQS otherwise
- [ ] UI settings section for configuring BYO Worker
- [ ] Tests for new endpoints
