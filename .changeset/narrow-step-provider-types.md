---
"@sweny-ai/engine": patch
---

Narrowed provider type hints in cross-repo-check and implement verify-access steps
to use `RepoProvider` instead of the full `SourceControlProvider` where only remote
API operations are needed.
