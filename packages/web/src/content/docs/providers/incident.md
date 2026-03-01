---
title: Incident
description: Create, acknowledge, and resolve incidents. Check on-call schedules.
---

The incident provider manages the lifecycle of production incidents. Use it when SWEny discovers a critical error that warrants paging someone — or to check who's on-call before escalating.

```typescript
import { pagerduty } from "@swenyai/providers/incident";
```

## Interface

```typescript
interface IncidentProvider {
  verifyAccess(): Promise<void>;
  createIncident(opts: IncidentCreateOptions): Promise<Incident>;
  acknowledgeIncident(id: string): Promise<void>;
  resolveIncident(id: string, resolution?: string): Promise<void>;
  getOnCall(scheduleId?: string): Promise<OnCallEntry[]>;
}
```

## PagerDuty

```typescript
const incidents = pagerduty({
  routingKey: process.env.PD_ROUTING_KEY!,  // Events API v2 integration key
  apiToken: process.env.PD_API_KEY!,        // REST API token (for on-call)
  logger: myLogger,
});
```

Uses the PagerDuty Events API v2 for incident lifecycle and the REST API for on-call lookups. Zero external dependencies — native `fetch` only.

### Creating an incident

```typescript
const incident = await incidents.createIncident({
  title: "payment-api: NullPointerException in WebhookHandler",
  description: "312 occurrences in the last 24h. Affects refund processing.",
  severity: "high",
  source: "sweny-triage",
});
// incident.id → "Q1234ABC"
```

### Checking on-call

```typescript
const oncall = await incidents.getOnCall();
// [{ userId: "P123", name: "Jane Doe", email: "jane@example.com", schedule: "Primary" }]
```

### Setup

You need two PagerDuty credentials:

| Credential | Where to get it | Used for |
|------------|----------------|----------|
| `routingKey` | Services > Your Service > Integrations > Events API v2 | Creating, acknowledging, resolving incidents |
| `apiToken` | User Settings > API Access > Create New API Key | On-call lookups |
