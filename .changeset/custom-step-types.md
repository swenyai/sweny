---
"@sweny-ai/cli": minor
---

`sweny workflow run` now accepts `--steps <path>` to load a custom step type
module before resolving the workflow. Teams can register their own step
implementations and reference them in YAML workflows alongside built-in types.
