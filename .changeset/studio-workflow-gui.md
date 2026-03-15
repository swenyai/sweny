---
"@sweny-ai/studio": minor
---

Studio is now the GUI for declarative YAML workflows.

- **Step type picker**: select built-in step types (sweny/investigate, sweny/create-pr, etc.) when adding nodes — pre-populates phase, uses, and type fields
- **YAML export**: primary export is now workflow YAML (compatible with `sweny workflow run`); JSON export kept as secondary
- **YAML import**: Import modal accepts YAML or JSON paste
- **Fork UX**: one-click fork of built-in workflows (triage, implement) into editable custom workflow
- **Step type display**: nodes show their type label as subtitle
