# WIP 3 — Where We Left Off

## Completed This Session

### Docs Site — Launch Ready
- **27 pages** across 5 sections, all building clean, all links valid
- **Agent Reference section** (4 new pages): Plugin System, Built-in Plugins, Model Architecture, Configuration
- **End-to-end walkthrough**: real error spike → investigation → ticket → PR flow with cost table
- **Troubleshooting/FAQ**: common issues for action, agent, and cost questions
- **Fleshed out thin pages**: outputs, incident, messaging, credential-vault with real examples
- **Real-world usage examples** added to all provider pages
- **V2 homepage** promoted to main index.mdx (clearer product explanation, two deployment modes)

### Language Genericized
- **"Claude AI"** → **"the agent"** in all product descriptions (19 edits across 11 files)
- **"Slack bot/agent"** → **"interactive agent"** in deployment descriptions
- **"AI"** qualifier removed entirely — SWEny orchestrates agents, not LLMs
- Kept implementation-specific references: `ClaudeCodeRunner`, credential names, pricing, SDK details

### CI Fix
- Added `npm run build --workspace=packages/providers` step before typecheck in CI
- Root cause: `tsc --noEmit` per workspace can't resolve `@sweny/providers/*` subpath imports without `dist/`

### Test Counts (unchanged from WIP_2)
- **providers**: 211 tests (18 files)
- **agent**: 120 tests (10 files)
- **action**: 12 tests (2 files)
- **Total**: 343 tests, zero failures

---

## What's Next — Launch Readiness Gaps

### Tier 1 — Do First (Credibility)

#### 1. Replace `console.error` with logger (11 instances)
Production code bypasses the logger and writes directly to stderr. Looks sloppy in OSS.

**Files:**
- `packages/agent/src/index.ts:103`
- `packages/agent/src/session/manager.ts:74,104,114`
- `packages/agent/src/slack/event-handler.ts:146,149`
- `packages/providers/src/storage/session/fs.ts:30,58,79`
- `packages/providers/src/storage/session/s3.ts:38,70,100`
- `packages/providers/src/storage/memory/fs.ts:29`
- `packages/providers/src/storage/memory/s3.ts:39`
- `packages/providers/src/storage/workspace/fs.ts:52`
- `packages/providers/src/storage/workspace/s3.ts:63`

**Approach:** Add optional `logger` parameter to storage factory functions. Default to `consoleLogger` for backward compat.

#### 2. Add ESLint + Prettier
No lint or formatting config exists. First contributor PR will have inconsistent style.

**Approach:**
- `eslint.config.js` (flat config, ESLint v9+) at root
- `prettier.config.js` at root
- Add `lint` and `format` scripts to root `package.json`
- Consider husky + lint-staged for pre-commit hooks

#### 3. Tests for action phases (0 tests, ~450 lines)
The core product loop — investigate → implement → notify — has zero test coverage.

**Files:**
- `packages/action/src/phases/investigate.ts` (~150 lines)
- `packages/action/src/phases/implement.ts` (~200 lines)
- `packages/action/src/phases/notify.ts` (~100 lines)
- `packages/action/src/main.ts` (~200 lines)

### Tier 2 — Do Before Promoting (Confidence)

#### 4. Tests for `claude/runner.ts`
The agent's brain — orchestrates prompt assembly, plugin resolution, model delegation. Zero tests.

#### 5. Tests for built-in plugins
`memoryPlugin()` (3 tools) and `workspacePlugin()` (6 tools) have no unit tests.

#### 6. Tests for `cloudwatch` provider
One of three observability providers. Datadog and Sentry have tests; CloudWatch does not.

#### 7. Tests for `model/adapter.ts`
The `toSdkTool()` bridge between `AgentTool` and Claude SDK format. Untested.

#### 8. Tests for `github-summary` notification provider
Simple but untested. The other 3 notification providers all have tests.

### Tier 3 — Nice to Have

#### 9. Slack channel adapter tests
`src/channel/slack.ts` — hard to unit test (Bolt dependency), may need integration test approach.

#### 10. CLI entry point tests
`src/cli.ts` — ~100 lines, readline-based REPL.

#### 11. Audit logger tests
`src/audit/console.ts` and `src/audit/fs.ts` — simple but untested.

---

## AgentRunner Extraction (from WIP_2, still pending)

Plan approved but not implemented. Extract `AgentRunner` interface from `ClaudeRunner` so the Orchestrator depends on an abstraction instead of a concrete class.

Full plan at: `.claude/plans/rosy-foraging-valiant.md`

---

## Suggested Order of Attack

1. `console.error` → logger cleanup (quick win, 30 min)
2. ESLint + Prettier setup (quick win, 30 min)
3. Action phase tests (highest-value coverage, 2-3 hrs)
4. AgentRunner extraction (from WIP_2, 1 hr)
5. Plugin + runner tests (1-2 hrs)
6. Remaining provider tests (1 hr)
