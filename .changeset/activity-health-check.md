---
"api": patch
---

Add `GET /api/v1/health`, which checks the database, a Redis projection write with projection
readiness, and a relay query through the configured transport. It returns `503` with the same
report when any check fails, so Railway's deploy health check and the new scheduled
`Production health` workflow can gate on the status code.
