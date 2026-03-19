# @sweny-ai/action

## 0.2.0

### Minor Changes

- 3f8ae88: Add Vercel and Supabase as supported observability providers in the GitHub Action.
  New inputs: vercel-token, vercel-project-id, vercel-team-id, supabase-management-key, supabase-project-ref.
- c412d72: Add Axiom observability provider for querying events and logs using APL (Axiom Processing Language).
- b34a0ce: Add Fly.io observability provider for querying runtime application logs.
- a2d3679: Add Heroku and OpsGenie observability providers for querying runtime logs and alert incidents.
- ee995c8: Add Honeycomb observability provider for querying events and traces using the Honeycomb Query API.
- ae842be: Auto-inject Jira MCP server (Category A) when issue-tracker-provider is jira, and add Asana as a new Category B workspace tool.
- b34a0ce: Add Netlify observability provider for querying build and deploy logs.
- ed18def: Wire up Prometheus and PagerDuty observability providers to factories, catalog, CLI, and Action integration layers.
- b34a0ce: Add Render observability provider for querying runtime logs from web services and workers.

### Patch Changes

- Updated dependencies [c412d72]
- Updated dependencies [b34a0ce]
- Updated dependencies [a2d3679]
- Updated dependencies [ee995c8]
- Updated dependencies [b34a0ce]
- Updated dependencies [ed18def]
- Updated dependencies [b34a0ce]
- Updated dependencies [cf13870]
- Updated dependencies [6914c92]
  - @sweny-ai/providers@1.2.0
  - @sweny-ai/engine@4.0.0

## 0.1.2

### Patch Changes

- 7194182: Fix engine preflight check failing when credentials are passed via action inputs. The engine reads required env vars from `process.env`; the action now populates them from inputs before validation runs. Also upgrades action runtime from `node20` to `node24`.

## 0.1.1

### Patch Changes

- 1df08e0: Task 03/04/05: wire slackMCP, add file providers to Action, shared factories.

  **providers (minor — new exports):**
  - `createObservabilityProvider(name, credentials, logger)` — shared factory for all 8 observability providers
  - `createCodingAgentProvider(name, logger, opts)` — shared factory for all 3 coding agents

  **cli (patch):**
  - `notification-provider: slack-mcp` now supported via `slackMCP()`
  - CLI and Action provider switches for observability and coding agent replaced with shared factory calls

  **action (patch):**
  - `issue-tracker-provider: file`, `source-control-provider: file`, `notification-provider: file` now supported
  - `slack-mcp` notification provider added
  - New `output-dir` input (default `.github/sweny-output`) for file-based providers
  - `slack-bot-token`, `slack-team-id`, `slack-channel` inputs added to `action.yml`

- Updated dependencies [2f1a424]
- Updated dependencies [0a59479]
- Updated dependencies [556a53d]
- Updated dependencies [68780d5]
- Updated dependencies [207a317]
- Updated dependencies [4465923]
- Updated dependencies [9313ff9]
- Updated dependencies [130138e]
- Updated dependencies [556a53d]
- Updated dependencies [ebbb5a7]
- Updated dependencies [42f6e95]
- Updated dependencies [010b6d7]
- Updated dependencies [f33c74d]
- Updated dependencies [1df08e0]
- Updated dependencies [4b4b29f]
  - @sweny-ai/providers@1.0.0
  - @sweny-ai/engine@2.0.0
