# @sweny-ai/core

**Workflows for coding agents. One set of rules, a receipt for every run.**

SWEny runs a DAG of coding-agent steps from a YAML file, on your laptop or in CI. The agent does the work. SWEny decides what it can touch, checks what it hands back, and records what it did.

## Start

```bash
npx @sweny-ai/core new                  # pick a named workflow, e.g. explain-repo (no skill credentials)
npx @sweny-ai/core check                # preflight: is your agent logged in?
npx @sweny-ai/core workflow run .sweny/workflows/explain-repo.yml
```

Install once with `npm install -g @sweny-ai/core` and the binary is `sweny`. Want to watch it first? `sweny try` replays a recorded demo with no login and no network (sample data, not a real run).

## Credentials

Requires Node 20+ and a login or API key for the agent that runs your nodes. Claude Code is the default; pick another with `--agent`.

| Agent | Credentials it needs |
|-------|----------------------|
| Claude Code (default) | `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`), or `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`, or a Claude Code login (`claude`, then `/login`), or Bedrock / Vertex routing. |
| Codex (`--agent codex`) | `CODEX_API_KEY`, `OPENAI_API_KEY` or `CODEX_ACCESS_TOKEN`, or a `codex login`. |
| pi (`--agent pi`) | The API key of the model provider pi calls (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...). |
| ACP agent (`--agent "acp:<command>"`) | Whatever that agent needs; pass its key var through `SWENY_ENV_PASSTHROUGH`. |

For Claude Code and Codex, `sweny check` and `sweny workflow run` stop with the fix when no credential or login is found, before any node runs. Skill credentials (`GITHUB_TOKEN` and so on) are separate and only needed by workflows that use those skills.

## What you get

Every run ends with a receipt: nodes, tool calls, duration, tokens, cost, and the policy the agent ran under. An example:

```text
╭┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╮
┆ ✓ passed                          run 3f9a2c ┆
┆ explain-repo                                 ┆
┆                                              ┆
┆ nodes       2/2                              ┆
┆ tool calls  12                               ┆
┆ duration    28s                              ┆
┆ tokens      30k                              ┆
┆ cost        $0.13                            ┆
┆ policy      env scoped, sandbox on           ┆
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤
┆          [ ENV SCOPED · SANDBOXED ]          ┆
╰┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╯
```

Then `sweny runs` lists your history, and `sweny runs diff` shows what changed in the answers between two runs. The [GitHub Action](https://docs.sweny.ai/action/) posts the same receipt on a PR, and recurring [packs](https://docs.sweny.ai/workflows/packs/) (weekly digest, dependency drift, PR risk review) run it on a schedule.

## Links

- [Quick start](https://docs.sweny.ai/getting-started/quick-start/)
- [CLI reference](https://docs.sweny.ai/cli/commands/)
- [Agents and policies](https://docs.sweny.ai/getting-started/agents-and-policies/)
- [Source and issues](https://github.com/swenyai/sweny)
