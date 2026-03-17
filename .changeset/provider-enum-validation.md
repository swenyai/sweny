---
"@sweny-ai/cli": patch
---

Unknown provider names now fail immediately at startup with a clear error listing valid values — catches typos like `datdog` before the spinner starts.
