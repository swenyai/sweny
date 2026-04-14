---
"@sweny-ai/core": minor
---

Add `-o, --output <path>` to `sweny workflow diagram` for writing the Mermaid
diagram to a file. Output format auto-detects from extension: `.mmd` writes
raw Mermaid (what `mmdc` and Mermaid Live Editor expect), `.md` writes a
fenced code block. Stdout behavior unchanged. Explicit `--block` / `--no-block`
always wins.
