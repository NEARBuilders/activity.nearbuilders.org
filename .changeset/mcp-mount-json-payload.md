---
"api": patch
---

Fix the host's generated MCP at `/api/mcp`, which returned 404. The `submitActivityEvent` payload was `z.json()`. That schema is recursive, so the OpenAPI spec emitted it as a `$ref` into `components`. The host builds each MCP tool's input schema without `components`, so Ajv failed on the unresolvable `$ref` and the whole MCP mount was skipped. The payload now validates exactly like `z.json()` but documents as a plain `{}` schema. A unit test now fails if any MCP tool input contains a `$ref`.
