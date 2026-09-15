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
| Relay endpoint | Selected host, DNS, TLS, persistent storage and named operator | Pending |
| Relay policy | Kind 1701, retention, write policy, connection limits and NIP-11 metadata | Pending |
| History capacity | Complete pagination across more than 500 records, including timestamp ties | Reproduced: 501 accepted events yielded 500; shared adapter now fails explicitly |
| Redis | Private connectivity, persistence, memory policy and monitored capacity | Local AOF only; production pending |
| Restore | Restore relay, database and Redis backups into isolated instances and reconcile IDs, moderation and counts | Local relay/Redis drill added; full database and production recovery pending |
| Health | Publish/read/subscribe, Redis write and projection rebuild checks on staging and production | Local integration passes; deployed checks pending |
| Operations | Metrics, alert routing, backup schedule, recovery objectives and incident owner | Pending |

Activity's domain scan limit is 1,000. Each adapter declares its transport's per-query cap
(500 for both the shared and direct adapters, matching the selected relay), and a scan
requests the smaller of the two. A scan that returns a full cap may hold only part of its
oldest second, so Activity drops that second and the next page starts from it. History of
any length therefore pages completely; only a single second holding a full cap of matching
events fails explicitly, because NIP-01 filters cannot split one second. A cap declared above
the relay's real limit would hide truncation, so change it together with the relay. Verified
against a local `mattn/nostr-relay` with 1,100 events at five per second: 11 pages, every
event once, in feed order.

The selected relay hardcodes both its advertised and backend query limit at 500;
its command-line flags do not expose a limit override. See the pinned version's
[configuration](https://github.com/mattn/nostr-relay/blob/v0.0.250/main.go) and
[limit declaration](https://github.com/mattn/nostr-relay/blob/v0.0.250/relay.go).

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
