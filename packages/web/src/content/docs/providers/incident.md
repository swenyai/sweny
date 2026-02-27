---
title: Incident
description: Create, acknowledge, and resolve incidents. Check on-call schedules.
---

```typescript
import { pagerduty } from "@sweny/providers/incident";
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
  routingKey: process.env.PD_ROUTING_KEY!,  // Events API v2
  apiToken: process.env.PD_API_KEY!,        // REST API (for on-call)
  logger: myLogger,
});
```

Uses the PagerDuty Events API v2 for incident lifecycle and the REST API for on-call lookups. Zero external dependencies.
