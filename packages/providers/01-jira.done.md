# Jira Issue Tracking Provider

Add `jira` provider to `issue-tracking/` implementing `IssueTrackingProvider` + `PrLinkCapable`.

- Jira REST API v3 (cloud) + v2 fallback
- Config: `baseUrl`, `email`, `apiToken`, `projectKey`
- Maps Jira issue keys (e.g. PROJ-123) to `Issue.identifier`
