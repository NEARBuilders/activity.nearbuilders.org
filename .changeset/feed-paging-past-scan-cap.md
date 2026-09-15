---
"api": patch
---

Page Activity history past the relay's per-query cap instead of failing. Through the shared Nostr
transport, any query matching 500 or more events returned `503`, so the public feed would stop
working once the relay held 500 Activity events. A full scan now drops its possibly-partial oldest
second and resumes there on the next page, so history of any length pages completely. Only a single
second holding a full cap of events still fails. The direct adapter declares the same 500 cap, so
it no longer stops early without saying so when a scan is mostly invalid or hidden events.
