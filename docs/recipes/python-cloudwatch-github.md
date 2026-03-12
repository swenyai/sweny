# Recipe: Python/FastAPI + CloudWatch + GitHub Issues

For Python applications (FastAPI, Django, Lambda, etc.) running on AWS that write logs to CloudWatch Logs. SWEny uses AWS credentials to query CloudWatch Logs Insights, investigates errors, and opens GitHub Issues (and optionally fix PRs).

## Stack

- **App**: Python / FastAPI / Lambda / ECS
- **Observability**: AWS CloudWatch Logs
- **Issue Tracker**: GitHub Issues
- **Source Control**: GitHub
- **Coding Agent**: Claude (default)

## Setup

### 1. Add `.sweny.yml` to your repo root

```yaml
# .sweny.yml
observability-provider: cloudwatch
cloudwatch-log-group-prefix: /aws/ecs/my-app
cloudwatch-region: us-east-1
issue-tracker-provider: github-issues
source-control-provider: github
time-range: 24h
severity-focus: errors
review-mode: review
```

Key fields:

| Key | Description |
|-----|-------------|
| `cloudwatch-log-group-prefix` | The CloudWatch log group name or prefix to search. For ECS: `/aws/ecs/<cluster>/<service>`. For Lambda: `/aws/lambda/<function-name>`. |
| `cloudwatch-region` | AWS region where your log groups live. Defaults to `us-east-1`. |
| `time-range` | How far back to look. `24h` is a sensible daily triage window. |

For Lambda functions you may have multiple log groups. Use a prefix that covers all of them:

```yaml
# .sweny.yml — Lambda variant
observability-provider: cloudwatch
cloudwatch-log-group-prefix: /aws/lambda/my-app
cloudwatch-region: eu-west-1
issue-tracker-provider: github-issues
source-control-provider: github
time-range: 6h
severity-focus: errors
review-mode: review
```

### 2. Configure secrets

```bash
# .env  — never commit this file
ANTHROPIC_API_KEY=sk-ant-...
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
GITHUB_TOKEN=ghp_...
```

| Variable | Where to get it |
|----------|-----------------|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM user or role — see IAM permissions below |
| `GITHUB_TOKEN` | Provided automatically in GitHub Actions |

#### Minimum IAM permissions

Create an IAM policy with these permissions and attach it to the IAM user or OIDC role used by your workflow:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:StartQuery",
        "logs:GetQueryResults",
        "logs:GetLogEvents",
        "logs:FilterLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:*:log-group:/aws/ecs/my-app*"
    }
  ]
}
```

### 3. Run locally

```bash
npx @sweny-ai/cli triage
```

## GitHub Actions

### Option A: IAM credentials (simple)

```yaml
# .github/workflows/triage.yml
name: SWEny Triage

on:
  schedule:
    - cron: "0 9 * * 1-5"   # weekdays at 09:00 UTC
  workflow_dispatch:

jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      - uses: sweny-ai/sweny@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          observability-provider: cloudwatch
          cloudwatch-log-group-prefix: /aws/ecs/my-app
          cloudwatch-region: us-east-1
          issue-tracker-provider: github-issues
          github-token: ${{ secrets.GITHUB_TOKEN }}
          time-range: 24h
          severity-focus: errors
          review-mode: review
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

### Option B: OIDC (recommended for AWS — no long-lived credentials)

```yaml
# .github/workflows/triage.yml
name: SWEny Triage

on:
  schedule:
    - cron: "0 9 * * 1-5"
  workflow_dispatch:

permissions:
  id-token: write    # required for OIDC
  contents: write
  issues: write
  pull-requests: write

jobs:
  triage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/sweny-triage-role
          aws-region: us-east-1

      - uses: sweny-ai/sweny@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          observability-provider: cloudwatch
          cloudwatch-log-group-prefix: /aws/ecs/my-app
          cloudwatch-region: us-east-1
          issue-tracker-provider: github-issues
          github-token: ${{ secrets.GITHUB_TOKEN }}
          time-range: 24h
          severity-focus: errors
          review-mode: review
```

## What SWEny Does

1. Runs a CloudWatch Logs Insights query against the configured log group(s) for the past 24 hours, filtering for lines matching `error`.
2. Aggregates errors by log stream (which maps to your ECS task or Lambda invocation).
3. Investigates the top error — reads the full log context from CloudWatch using the AWS CLI.
4. Checks GitHub Issues for existing coverage (novelty mode).
5. If novel: creates a GitHub Issue with a detailed description, log excerpts, and fix suggestions.
6. If `review-mode: auto` and the fix is low-risk: opens a pull request.

## Tips

- **Log group prefix vs exact name**: `cloudwatch-log-group-prefix` is passed as `logGroupName` to the CloudWatch Logs Insights `StartQuery` API. It must exactly match a log group name — partial prefix matching only works for `DescribeLogGroups`. Use the full log group path.
- **Multiple log groups**: CloudWatch Logs Insights supports querying multiple log groups. If you need this, set `cloudwatch-log-group-prefix` to the longest common prefix (e.g., `/aws/ecs/my-app`) and all matching log groups will be searched.
- **`AWS_REGION` environment variable** is also accepted by the CloudWatch provider. If you use `aws-actions/configure-aws-credentials`, it sets `AWS_DEFAULT_REGION` automatically — you can omit `cloudwatch-region` in that case as long as you set `AWS_REGION`.
- **Structured logs**: Python apps that emit JSON logs (e.g., via `structlog` or `python-json-logger`) will give SWEny richer context. Ensure your logs include `level`, `message`, and `traceback` fields.
- **Lambda cold start noise**: add `service-filter: your-function-name` to scope investigation to a specific log stream pattern and avoid cold-start messages polluting the results.
- **OIDC is strongly preferred** over long-lived IAM credentials. Follow the [GitHub OIDC guide](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services) to set up the trust policy.
