---
"@sweny-ai/engine": patch
"@sweny-ai/cli": patch
"@sweny-ai/studio": patch
"@sweny-ai/providers": patch
"@sweny-ai/agent": patch
---

Add missing npm package metadata: keywords, bugs URL, and description improvements across all published packages. Fix engine description to say "Workflow" (not "Recipe"). Align Node.js engine requirement for cli and agent to >=22.0.0 to match providers (which uses global fetch).
