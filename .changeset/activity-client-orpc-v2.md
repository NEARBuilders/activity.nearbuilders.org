---
"@nearbuilders/activity-client": minor
---

Build the client on oRPC 2 and everything-dev v2. `createActivityClient(baseUrl, options)` and the contract import path are unchanged. The package now declares `@orpc/openapi` and `zod`, which the bundled contract imports directly instead of through the removed `every-plugin/orpc` and `every-plugin/zod` facades.
