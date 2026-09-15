---
"api": patch
---

Bundle `redis` into the API instead of leaving it external. The production host doesn't ship
`redis`, so the deployed API failed to load with `Cannot find package 'redis'` and every API
call returned 503. Bundling it needed a JSON rule, because the drizzle migrations plugin forces
every module (JSON included) to parse as JavaScript, which broke on `@redis/client`'s
`require("../../package.json")`.
