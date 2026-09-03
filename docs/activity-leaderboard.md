# Activity leaderboard

## Query model

`GET /api/v1/leaderboard` accepts `period=weekly|monthly|all-time`, `limit`, and optional `source`
and `type` filters. Weekly periods run from Monday 00:00 UTC to the following Monday. Monthly
periods run from the first day of a UTC month to the first day of the next month. The all-time
period has no start, end, or expiry boundary.

`GET /api/v1/leaderboard/status` reports projection readiness and rebuild counters even when the
ranking endpoint is unavailable.

Each response includes rank, actor, dynamically weighted score, raw event count, per-source and
per-Event-Type breakdown, the exact period boundaries, and projection rebuild status.

## Redis representation

The projection stores one sorted set per period bucket, Activity Source, and Event Type. Members are
actors and scores are raw event counts. A global event-state hash records each immutable Nostr event
as included or excluded. Lua updates the state and all three period counts atomically, so ingestion
retries, relay replay, repeated hides, and hide-before-replay cannot double count or resurrect an
event.

Leaderboard reads fetch current Event Type point values from Postgres and use a temporary Redis
weighted union to calculate the exact score. The temporary result is used only to select the top
actors; their raw counts are then returned as a full breakdown. A point-value update changes the next
read without modifying Redis or replaying Nostr history.

Weekly and monthly sorted sets expire 24 hours after their period closes. The all-time sorted sets
and event-state hash do not expire because they provide the permanent exactly-once record.

## Reconnect and rebuild

The Redis client reports connection errors and reconnect attempts without crashing the API, and
reconnects automatically after a transient connection loss. Redis AOF persistence preserves
projection keys across ordinary container restarts. A missing or non-ready status on API startup
triggers a rebuild: the leaderboard namespace is cleared, durable hidden-event tombstones are
applied first, and the complete Postgres submission ledger is replayed. That ledger contains every
server-signed Activity event and is not subject to relay query caps. A signed submission in the
narrow window before its successful publication commit is included only when an exact event-ID
lookup confirms it on the relay. The projection is marked ready only after the ledger and those
relay confirmations complete.

The status endpoint and successful ranking responses expose `state`, `rebuiltAt`, `seen`, `applied`,
and `hidden`. Startup logs rebuild start, completion counters, or failure. A failed rebuild leaves the
stored state as `failed` and fails startup instead of serving a silently partial ranking.

Production requires the `ACTIVITY_REDIS_URL` secret. Local development uses the in-memory adapter
unless that variable is set; `npm run dev:activity-infra` starts the persistent local Redis adapter.

## Benchmark

Run:

```bash
npm run benchmark:leaderboard
```

The benchmark seeds 10,000 actors across 50 Event Types, requests the exact weighted top 100, and
fails above 500 ms. The latest local Issue #8 verification completed the query in 337.22 ms.
