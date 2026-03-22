---
"@sweny-ai/engine": patch
---

Fix investigate step not passing observability provider credentials to the coding agent subprocess. Previously only a hardcoded set of legacy providers (Datadog, Sentry, etc.) had their env vars forwarded to Claude; providers added later (Supabase, Vercel, Netlify, Fly, Render, etc.) were silently omitted, so Claude had no credentials to query logs during investigation. Now uses `observability.getAgentEnv()` directly, which every provider already implements.
