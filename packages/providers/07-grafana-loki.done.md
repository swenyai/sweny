# Grafana Loki Observability Provider

Add `loki` provider to `observability/` implementing `ObservabilityProvider`.

- Loki HTTP API (query_range endpoint)
- Config: `baseUrl`, `apiKey` (optional for self-hosted), `orgId`
- LogQL query generation
