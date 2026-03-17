# @sweny-ai/action

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
