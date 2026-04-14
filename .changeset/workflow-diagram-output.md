---
"@sweny-ai/core": minor
---

Overhaul `sweny workflow diagram` output so it's directly consumable by
`mmdc`, Mermaid Live Editor, and GitHub/GitLab inline renderers:

- **Raw Mermaid is now the default** — no more ` ```mermaid ` fence and no
  more `---\ntitle: …\n---` frontmatter on stdout. The previous defaults
  broke `mmdc` and Mermaid Live because they don't accept fences or title
  frontmatter.
- **`--title` is opt-in.** It used to default to the workflow name; it now
  emits nothing unless you pass `--title "Something"`.
- **`.mmd` and `.mermaid` output** stays raw; **`.md` / `.markdown` output**
  auto-wraps in a ` ```mermaid ` fence for drop-in README/PR usage.
- **`-o, --output <path>`** writes to a file instead of stdout and creates
  parent directories as needed.
- Explicit `--block` / `--no-block` always wins over extension inference.

**Breaking:** stdout and `.mmd` output no longer contain a fenced block or
a title frontmatter. If you relied on the old defaults, pass `--block` and
`--title "$name"` explicitly. `.md` output is unchanged.
