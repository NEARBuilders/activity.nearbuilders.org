# Activity infrastructure readiness

Tracks the locally verifiable portion of [issue #12](https://github.com/NEARBuilders/activity.nearbuilders.org/issues/12).
This is an operating and acceptance guide, not evidence of a production deployment.

## Current evidence

The API integration suite covers signed publishing and filters, live delivery,
retained history, pagination and provenance, replay deduplication, current point
values, moderation, and explicit rejection of truncated history. It does not prove
backup restoration or complete production history capacity.

The production transport is the hosted Nostr plugin RPC endpoint configured in `bos.config.json`.
Local verification uses the API's in-process relay fixtures and does not require a Nostr checkout.

## Deployment contract

- nearbuilders.org is the user-facing integration target. Its backend submits to Activity;
  its readers use Activity feed, SSE and leaderboard APIs.
- Activity owns source approval, Signing Identities, Source API Keys, submission records,
  provenance, moderation and scoring.
- The shared Nostr plugin publishes, queries and streams signed events. Deploying the
  plugin does not deploy or replace the durable relay.
- Activity's optional `ACTIVITY_NOSTR_RPC_URL` selects the shared plugin. Its configured
  relay destination must also be allowed by that plugin. Omitting the RPC setting retains
  the existing direct adapter; this is an explicit transport choice.
- The streaming endpoint is the hosted Nostr plugin's `/api/rpc/nostr` route, not its
  standalone plugin development port, which buffers streaming responses.
- No additional Nostr API key is needed by this integration. Relay write and authentication
  policy must match the capabilities of the selected client and relay.

## Production acceptance gates

| Gate | Required evidence | Current status |
| --- | --- | --- |
| Relay endpoint | Selected host, DNS, TLS, persistent storage and named operator | Deployed: `wss://relay.nearbuilders.org` on Railway running strfry from [`infra/relay`](../infra/relay/README.md), Let's Encrypt TLS, LMDB on a persistent `/data` volume. Named operator pending |
| Relay policy | Kind 1701, retention, write policy, connection limits and NIP-11 metadata | Met: accepts only kinds `0,1,1111,1701`, rate-limits writes per client address (20/s, burst 300), NEAR Builders NIP-11 document, `maxFilterLimit` 1,000, four tag filters, 128 KiB frames, 200 subscriptions per connection. Retention is unlimited; no expiry policy is defined yet |
| History capacity | Complete pagination across more than 500 records, including timestamp ties | Met: a full scan drops its partial oldest second and resumes there. Verified against strfry with 2,500 events at five per second (25 pages, every event once, in feed order) and against the previous relay with 1,100 |
| Redis | Private connectivity, persistence, memory policy and monitored capacity | Deployed: Railway `redis:8.2` reachable only on private networking (`redis.railway.internal`) with a persistent volume. Persistence settings, memory policy and monitoring pending |
| Restore | Restore relay, database and Redis backups into isolated instances and reconcile IDs, moderation and counts | Local relay/Redis drill added; full database and production recovery pending |
| Health | Publish/read/subscribe, Redis write and projection rebuild checks on staging and production | `GET /api/v1/health` checks the database, a Redis write with projection readiness, and a relay query; the scheduled `Production health` workflow calls it every 15 minutes. A production publish, retry, SSE and leaderboard round trip passed with `examples/run-activity-example.ts` on 2026-09-16, run manually. No staging environment exists |
| Operations | Metrics, alert routing, backup schedule, recovery objectives and incident owner | Pending. The only alert is the failed-workflow notification from `Production health` |

Activity's domain scan limit is 1,000. Each adapter declares its transport's per-query cap
(500 for both the shared and direct adapters, matching the selected relay), and a scan
requests the smaller of the two. A scan that returns a full cap may hold only part of its
oldest second, so Activity drops that second and the next page starts from it. History of
any length therefore pages completely; only a single second holding a full cap of matching
events fails explicitly, because NIP-01 filters cannot split one second. A cap declared above
the relay's real limit would hide truncation, so change it together with the relay. Verified
against a local `mattn/nostr-relay` with 1,100 events at five per second: 11 pages, every
event once, in feed order.

Both adapters still declare 500, which is below the deployed relay's `maxFilterLimit` of 1,000
and therefore safe; raising them only reduces the number of round trips. The previous relay
(`mattn/nostr-relay`) hardcoded 500 with no override, which is one of the reasons it was
replaced by strfry; see [`infra/relay`](../infra/relay/README.md).

## Health check

`GET /api/v1/health` is public and returns `200` with `status: "ok"` only when every check
passes. Otherwise it returns `503` with the same report, so a deploy gate or uptime monitor
can use the status code alone. Each failed check carries a fixed message; the cause is in the
`activity-app` logs under `[ActivityHealth]`.

| Failed check | Meaning | First response |
| --- | --- | --- |
| `database` | `select 1` against `API_DATABASE_URL` failed or took over 8s | Check the Postgres service and the `activity-app` connection secret |
| `redis` | A write/read-back to the projection namespace failed, or the projection is `failed`/`uninitialized` | Check the Redis service and `ACTIVITY_REDIS_URL`; then follow step 3 below |
| `relay` | A one-event kind 1701 query through the configured transport failed or timed out | Check the relay service and the shared Nostr RPC; then follow step 1 below |

The scheduled check deliberately does not publish events. Every published test event stays in
relay history, counts toward the history-capacity limit above, and scores for its actor.
Run the example round trip manually against a dedicated test source when a change affects
publishing, SSE or scoring.

## Failure and recovery procedure

1. For a relay outage, retain submission records and retry the same action with its
   original idempotency key after recovery. Check the intended relay's acknowledgement
   and exact event ID before treating publication as successful.
2. After reconnect, verify retained history and resume Activity SSE with `Last-Event-ID`.
   Shared transport replay is bounded; reconnect alone is not proof of complete recovery.
3. For Redis failures, inspect `/api/v1/leaderboard/status` and restore connectivity.
   Verify projection readiness and reconcile scores with accepted submission records and
   hidden-event tombstones. The existing startup rebuild uses the durable submission ledger;
   see [leaderboard recovery](activity-leaderboard.md#reconnect-and-rebuild).
4. Never clear live volumes or local source/auth databases as a recovery shortcut.
   Restore backups into isolated instances first and compare event IDs and rankings.
5. Before switching transport back to the direct adapter, verify that it points to the
   same relay and passes publish, query and live-delivery checks. Transport rollback
   does not recover a failed relay. Reader/writer rollback to legacy nearbuilders.org
   remains work in issues #13 and #14.

## Work order

1. Review the portable shared-adapter integration tests and scoped local Activity changes.
2. Resolve and test history capacity, then exercise backup restoration and outage behavior.
3. Select production infrastructure and ownership; complete the deployed acceptance gates.
4. Implement reversible nearbuilders.org writer integration (#13), then history and reader
   cutover (#14). Launch and adoption evidence (#16) follow those dependencies.

Keep issue #12 open until the production criteria are demonstrated.
