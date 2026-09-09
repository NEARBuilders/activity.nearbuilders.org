---
"api": patch
"ui": patch
---

Add a first-run-friendly master-key generator (`bun run keys:gen`) and a fail-fast check in the API runtime that refuses to boot with an empty `ACTIVITY_SIGNING_MASTER_KEYS` when `NODE_ENV=production`. README and protocol docs gain a "generate, rotate, recover" runbook so the dev path (`bun run keys:gen`) and the production path (operator-provisioned secret) are unambiguous.
