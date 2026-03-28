---
"@sweny-ai/core": minor
---

feat: dry-run hard gate, multi-finding routing, result banners

- Executor enforces dry run at first conditional routing point — zero side effects, cannot be bypassed by LLM evaluation
- Investigate node outputs findings array with per-finding severity/complexity/duplicate classification
- Routing based on novel_count instead of single is_duplicate flag — novel findings route to create_issue while duplicates get +1'd
- Workflow input included in edge evaluation context so conditions can reference input flags
- Result banners: "Triage Complete (Dry Run)" with findings summary, "Issues Created" for complex-fix path, fixed "No Action Needed" for all-duplicates case
- Accept BETTERSTACK_TELEMETRY_TOKEN and BETTERSTACK_UPTIME_TOKEN as alternatives to BETTERSTACK_API_TOKEN
