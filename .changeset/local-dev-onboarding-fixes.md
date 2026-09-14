---
"api": patch
---

Fix local dev onboarding end-to-end and close out issues #29, #30, #33.

- Add `bun run first-run` / `bun run setup:check` (#30): bootstraps `.env`, mints a local
  signing keyring only if none exists, wires local relay/redis, brings up infra, never
  overwrites a real value.
- Add `bun run compose:doctor`, wired as a `predev` hook (#29): fails loudly on the
  `compose.activity.yml` / `docker-compose.yml` port collision instead of silently
  colliding.
- Add `docs/research/nostr-plugin-integration.md` (#33): the Nostr plugin surface study
  for RFC #32, built from nearbuilders.org PR #225 and this repo's live plugin contract.
- Add `bun run seed:demo`: seeds a demo Activity Source, signing identity, and sample
  events through the real ingestion pipeline for local UI testing.
- Fix `api/plugin.dev.ts` loading `.env` relative to `process.cwd()` (`api/` under
  `bos dev`), which silently broke every local env override regardless of value.
- Add `ACTIVITY_LOCAL_RELAY_ONLY` to bypass the shared Nostr plugin's remote RPC for local
  dev, since that transport is otherwise always used even locally and can't reach a
  local-only relay URL.
- Add `RATE_LIMIT_MAX` and document `ACTIVITY_LOCAL_RELAY_ONLY` in `.env.example`; both
  were previously undocumented traps for a fresh clone.
- Add server-side logging where relay failures were being silently swallowed into a
  generic "Activity relay is unavailable" with no cause.
