# Align Cloud Worker with Engine

## Context
The cloud worker at `cloud/services/worker/src/runner/triage.ts` currently duplicates triage logic — it shells out to `claude-code` CLI directly, parses output with custom regexes, and manages git operations manually. It doesn't use `@sweny/providers` or the engine at all.

This task refactors the cloud worker to use `@sweny/engine`'s triage recipe, making it a thin entry point that hydrates providers from credentials and calls `runWorkflow`.

After this task, triage logic lives in one place (the engine recipe), and cloud/action/CLI are all thin wrappers around it.

## Dependencies
- Task 32 (engine package) must be complete
- Task 33 (triage recipe) must be complete

## Files to Modify

### `cloud/services/worker/package.json`
Add dependencies:
- `@sweny/engine` (workspace or published version)
- `@sweny/providers` (workspace or published version)

May be able to remove `@anthropic-ai/claude-code` direct dependency since it's now accessed through `@sweny/providers`' `claudeCode` provider.

### `cloud/services/worker/src/runner/triage.ts` — REWRITE
Current flow (replace entirely):
```
clone repo → shell to claude -p → parse JSON → maybe shell again → git push → gh pr create
```

New flow:
```typescript
import { runWorkflow, triageWorkflow, createProviderRegistry } from "@sweny/engine";
import { datadog, sentry, cloudwatch } from "@sweny/providers/observability";
import { linear, githubIssues, jira } from "@sweny/providers/issue-tracking";
import { github } from "@sweny/providers/source-control";
import { slackWebhook, email, webhook } from "@sweny/providers/notification";
import { claudeCode } from "@sweny/providers/coding-agent";

export async function runTriageJob(payload: TriageJobPayload): Promise<TriageJobResult> {
  // 1. Clone the repo (keep this — engine doesn't handle repo checkout)
  await cloneRepo(payload);

  // 2. Hydrate providers from payload.credentials
  const providers = createProviderRegistry();
  providers.set("observability", createObservabilityProvider(payload.credentials));
  providers.set("issueTracker", createIssueTracker(payload.credentials));
  providers.set("sourceControl", github({ token: payload.credentials.githubToken, ... }));
  providers.set("notification", createNotificationProvider(payload.credentials));
  providers.set("codingAgent", claudeCode({ logger }));

  // 3. Map payload → TriageConfig
  const triageConfig = mapPayloadToTriageConfig(payload);

  // 4. Run workflow
  const result = await runWorkflow(triageWorkflow, triageConfig, providers, { logger });

  // 5. Map WorkflowResult → TriageJobResult (for DB storage)
  return mapToJobResult(result);
}
```

### `cloud/services/worker/src/index.ts`
Update the BullMQ consumer to call the new `runTriageJob`. The job status management (pending → running → completed/failed) and DB writes should stay — just the execution logic changes.

### `cloud/packages/shared/src/types.ts`
Review `TriageJobPayload` and `TriageJobResult` — they may need slight updates to align with engine types, but keep backward compatibility with the API/UI.

## Key Design Decisions

1. **Repo cloning stays in worker** — The engine doesn't handle git checkout. The worker clones the repo, `cd`s into it, then hands off to the engine. This is entry-point-specific behavior.

2. **Provider hydration from credentials** — The worker decrypts credentials from the DB and instantiates the right providers based on what the org has configured. This is the cloud-specific value-add.

3. **Result mapping** — The engine returns `WorkflowResult` with step-level detail. The worker maps this to `TriageJobResult` for the simpler DB schema. Step-level detail could be stored separately later for the dashboard.

4. **Notification routing** — In cloud, notification should go to whatever the org configured (Slack, email, webhook) rather than just GitHub Summary. The worker reads org notification config and instantiates the right provider.

## Verification
- `npm run build` in `cloud/services/worker` passes
- Worker can process a job from the BullMQ queue using the engine
- `TriageJobResult` schema remains compatible with existing API/UI expectations
- Cloud API doesn't need changes (job dispatch is unchanged)
