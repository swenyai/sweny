---
title: Service Map
description: Configure cross-repo dispatch with a service ownership map.
---

When SWEny finds an error in a service that lives in a different repository, it can automatically dispatch the fix workflow to the correct repo.

## Setup

Create `.github/service-map.yml` in your repository:

```yaml
services:
  api-gateway:
    repo: "your-org/api-gateway"
    owns:
      - api-gateway
      - api-gateway-staging
  billing-service:
    repo: "your-org/billing"
    owns:
      - billing-svc
      - billing-svc-staging
  auth-service:
    repo: "your-org/auth"
    owns:
      - auth-svc
```

## How it works

1. SWEny investigates errors across all services (or filtered by `service-filter`)
2. When the best candidate error belongs to a service like `billing-svc`, SWEny looks up the owner in the service map
3. If the owner repo (`your-org/billing`) differs from the current repo, SWEny dispatches a `workflow_dispatch` event to the target repo
4. The target repo runs its own SWEny workflow with the specific issue context

## Requirements

For cross-repo dispatch, you need a `bot-token` with `repo` and `actions` scopes for all target repositories:

```yaml
- uses: swenyai/sweny@v1
  with:
    bot-token: ${{ secrets.BOT_TOKEN }}
    # ... other inputs
```

## Custom path

By default, SWEny looks for the service map at `.github/service-map.yml`. Override with:

```yaml
- uses: swenyai/sweny@v1
  with:
    service-map-path: 'config/services.yml'
    # ... other inputs
```
