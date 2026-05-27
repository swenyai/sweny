---
title: Model gateway (LiteLLM)
description: Route SWEny through an Anthropic-compatible gateway for cost tiering and multi-model routing.
---

SWEny runs on headless Claude Code. It does not ship a native Gemini or OpenAI provider, and it is not going to. But Claude Code respects `ANTHROPIC_BASE_URL`, so you can point the backend at any Anthropic-compatible gateway (a [LiteLLM](https://docs.litellm.ai/) proxy, a corporate egress proxy, an observability proxy) and let the gateway route to whatever model you want. Combined with [per-node model selection](/nodes#model-selection), this gives you cost tiering: a cheap model on the grunt steps, a strong model on the reasoning steps.

:::caution[Tool use and structured output are unsupported through a gateway]
SWEny relies on Claude Code's tool-use protocol and JSON output behavior, which assume an Anthropic model. Routing a node to a non-Anthropic model (e.g. Gemini via LiteLLM) may produce flaky tool calls or output that does not honor a node's `output` schema. This path is at your own risk. Use cheaper Anthropic models (e.g. `claude-haiku-4-5`) for the most reliable cost tiering, and reserve non-Anthropic models for nodes that do not depend on tools or structured output.
:::

## Environment variables

| Variable | Header | Purpose |
| --- | --- | --- |
| `ANTHROPIC_BASE_URL` | n/a | Base URL of the gateway, e.g. `https://litellm.internal/v1`. |
| `ANTHROPIC_API_KEY` | `x-api-key` | API-key auth. Real Anthropic console keys are billing-sensitive. |
| `ANTHROPIC_AUTH_TOKEN` | `Authorization: Bearer` | Bearer auth. Most LiteLLM deployments expect this (e.g. `sk-litellm-...`). Not a console key. |
| `SWENY_AUTH` | n/a | Auth mode: `auto` (default), `api-key`, or `oauth`. |

### Why `SWENY_AUTH` exists

By default (`auto`), when a Claude Code OAuth token is present, SWEny strips `ANTHROPIC_API_KEY` from the subprocess environment. This protects you from a stray `.env` key silently billing a metered API account when you meant to use your subscription.

That protection gets in the way when you deliberately want to authenticate a gateway with a key while an OAuth token also happens to be in your environment (common after `claude setup-token`). Set `SWENY_AUTH=api-key` to opt in: SWEny then preserves both `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`.

SWEny does **not** infer this from the presence of `ANTHROPIC_BASE_URL`. A base URL does not mean "non-billing gateway": pass-through proxies set it while still billing your real key. The auth choice must be explicit, because guessing wrong toward a key fails silently and costs money, while guessing toward OAuth just fails the call and you fix the config.

| `SWENY_AUTH` | Behavior |
| --- | --- |
| `auto` (default) | When an OAuth token is present, strip `ANTHROPIC_API_KEY`. Never touches `ANTHROPIC_AUTH_TOKEN`. |
| `api-key` | Preserve `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` even when an OAuth token is present. |
| `oauth` | Force subscription/OAuth: strip both `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`. |

## GitHub Action

The action exposes matching inputs:

```yaml
- uses: swenyai/sweny@v5
  with:
    workflow: .sweny/workflows/upgrade.yml
    anthropic-base-url: https://litellm.internal/v1
    anthropic-auth-token: ${{ secrets.LITELLM_TOKEN }}
    sweny-auth: api-key
```

## Cost tiering example

Put a cheap model on the mechanical nodes and the default (or a stronger) model on the reasoning node. Resolution is `node.model` → `workflow.model` → executor default.

```yaml
id: helm-upgrade
name: Helm chart upgrade
entry: plan
model: claude-opus-4-6 # workflow default for the thinking
nodes:
  plan:
    name: Plan the upgrade
    instruction: Read the chart and the changelog, decide what changes are needed.
    skills: [github]
  apply:
    name: Apply mechanical edits
    instruction: Make the version bumps and formatting changes.
    skills: [github]
    model: claude-haiku-4-5 # cheap grunt work
edges:
  - from: plan
    to: apply
```

With `ANTHROPIC_BASE_URL` pointed at LiteLLM, you can alias `claude-haiku-4-5` (or any model name) to a cheaper backend in your LiteLLM config.

## Verifying the connection

`sweny check` is gateway-aware. When `ANTHROPIC_BASE_URL` is set it probes the gateway (not real Anthropic) and reports the selected auth mode. The base URL is redacted to scheme and host in output so a credential embedded in the URL never logs.

```
✓  Anthropic (gateway)
   gateway reachable (https://litellm.internal), auth mode: auth-token
```

## Caveat: prompt caching

Mixing models across nodes means a cheap grunt node does not share prompt cache with the expensive reasoning node, and a gateway may disable Anthropic prompt caching entirely. The per-node savings are real, but do not assume cache hit rates from a single-model run carry over.
