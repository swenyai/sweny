---
"@sweny-ai/action": patch
---

Fix engine preflight check failing when credentials are passed via action inputs. The engine reads required env vars from `process.env`; the action now populates them from inputs before validation runs. Also upgrades action runtime from `node20` to `node24`.
