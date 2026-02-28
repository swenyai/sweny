# Update README with Complete Provider Table

Update the providers package README to list all providers including the new ones.

## Working directory
`/Users/nate/src/swenyai/sweny/packages/providers`

## Task

Read `README.md` first, then update it.

### Update the provider table to include ALL providers:

**Observability** (7 providers):
| Provider | Factory | Config |
|----------|---------|--------|
| Datadog | `datadog()` | `apiKey`, `appKey`, `site` |
| Sentry | `sentry()` | `authToken`, `organization`, `project` |
| CloudWatch | `cloudwatch()` | `region`, `logGroupPrefix` |
| Splunk | `splunk()` | `baseUrl`, `token`, `index` |
| Elasticsearch | `elastic()` | `baseUrl`, `apiKey` or `username`/`password`, `index` |
| Grafana Loki | `loki()` | `baseUrl`, `apiKey`, `orgId` |
| New Relic | `newrelic()` | `apiKey`, `accountId`, `region` |

**Issue Tracking** (3 providers):
| Provider | Factory | Config |
|----------|---------|--------|
| Linear | `linear()` | `apiKey` |
| GitHub Issues | `githubIssues()` | `token`, `owner`, `repo` |
| Jira | `jira()` | `baseUrl`, `email`, `apiToken` |

**Source Control** (2 providers):
| Provider | Factory | Config |
|----------|---------|--------|
| GitHub | `github()` | `token`, `owner`, `repo` |
| GitLab | `gitlab()` | `token`, `projectId`, `baseUrl` |

**Incident Management** (2 providers):
| Provider | Factory | Config |
|----------|---------|--------|
| PagerDuty | `pagerduty()` | `apiToken`, `routingKey` |
| OpsGenie | `opsgenie()` | `apiKey`, `region` |

**Messaging** (2 providers):
| Provider | Factory | Config |
|----------|---------|--------|
| Slack | `slack()` | `token` |
| Microsoft Teams | `teams()` | `tenantId`, `clientId`, `clientSecret` |

**Notification** (4 providers):
| Provider | Factory |
|----------|---------|
| GitHub Summary | `githubSummary()` |
| Slack Webhook | `slackWebhook()` |
| Teams Webhook | `teamsWebhook()` |
| Discord Webhook | `discordWebhook()` |

**Storage** (3 backends):
| Provider | Factory | Config |
|----------|---------|--------|
| Filesystem | `fsStorage()` | `baseDir` |
| AWS S3 | `s3Storage()` | `bucket`, `prefix`, `region` |
| CSI / Kubernetes PVC | `csiStorage()` | `mountPath`, `volumeName`, `namespace` |

**Credential Vault** (2 backends):
| Provider | Factory | Config |
|----------|---------|--------|
| Environment Variables | `envVault()` | `prefix` |
| AWS Secrets Manager | `awsSecretsManager()` | `region`, `prefix` |

**Auth** (2 providers): noAuth, apiKeyAuth
**Access** (2 guards): allowAllGuard, roleBasedGuard
**Coding Agent**: claudeCode
**Agent Tool**: agentTool factory

### Also update:
- Any "planned" or "coming soon" sections to remove items that are now shipped
- Ensure usage examples reflect the current API
- Keep the existing structure/style of the README

## Completion

1. Rename: `mv packages/providers/20-readme-update.todo.md packages/providers/20-readme-update.done.md`
2. Commit:
```
docs: update README with complete provider catalog

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```
