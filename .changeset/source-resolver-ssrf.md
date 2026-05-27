---
"@sweny-ai/core": patch
---

Harden source resolution against SSRF, credential exfiltration, and path traversal. URL sources now enforce an http/https scheme allowlist, block private/loopback/link-local addresses (including the cloud metadata endpoint 169.254.169.254 and IPv6 equivalents), and re-validate every redirect hop with `redirect: "manual"`. The fetch token is scoped to explicitly allowlisted hosts only (no blanket `SWENY_FETCH_TOKEN` fallback), and a redirect to a non-allowlisted host drops the credential. An opt-in repo-root sandbox for `file:` sources rejects paths that escape the root, with an `allowFileOutsideRoot` opt-out. Legitimate https URLs and in-repo relative file paths are unaffected.
