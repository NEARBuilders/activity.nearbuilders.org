# Activity event protocol

## Event envelope

Activity records are signed Nostr events of kind `1701`. This is a regular event kind in the
`1000`–`9999` range: every event ID is immutable, and publishing another event never replaces or
deletes an earlier event. Activity does not use addressable (`30000`–`39999`) or replaceable kinds.

The JSON payload is stored in `content`. Fields that relays must index are duplicated into tags:

| Activity field | Nostr tag | Example |
| --- | --- | --- |
| source | `s` | `["s", "github.nearbuilders.org"]` |
| event type | `t` | `["t", "github.pr.merged"]` |
| NEAR actor | `n` | `["n", "alice.near"]` |
| source-scoped idempotency key | `i` | `["i", "github:pr:42"]` |

Consumers query these fields with NIP-01 tag filters (`#s`, `#t`, `#n`, and `#i`). Redis projection
uses the `[source, idempotency key]` pair as its atomic deduplication identity, so separately signed
events carrying the same source-scoped idempotency key count once. Projected counters are also
source-scoped and cannot merge event types declared by different Activity Sources.

## Transport boundary

The local boundary pins `nostr-tools@2.24.1`, `ws@8.21.3`, and `redis@6.2.1`, matching the transport
generation used by the released
[`@every-plugin/nostr@1.0.0`](https://github.com/NEARBuilders/nostr.nearbuilders.org/releases/tag/%40every-plugin%2Fnostr%401.0.0).
It supports relay `OK` acknowledgements, tag-filtered queries, live subscriptions, automatic
reconnection and resubscription, and explicit shutdown. No application plugin is imported yet;
the boundary is deliberately small enough to move behind the shared Nostr plugin when its public
contract includes the required streaming lifecycle.

Queries order events by `(created_at DESC, id DESC)`. The opaque cursor contains both values. Relay
queries include the cursor second, then discard IDs at or ahead of the cursor locally, preventing
events with the same Nostr timestamp from being skipped or repeated. Each relay scan requests up to
1,000 matching records and exposes pages of at most 100 records. A response that reaches the scan
limit fails loudly instead of returning a cursor that could silently omit same-second events.

## Local workflow

Start the pinned relay and Redis services, run the integration proof, and stop the services with:

```bash
bun run dev:activity-infra
bun run test:activity
bun run dev:activity-infra:down
```

Defaults are `ws://127.0.0.1:7447` for the relay and `redis://127.0.0.1:6380` for Redis. Override
them with `ACTIVITY_RELAY_URL` and `ACTIVITY_REDIS_URL`. Docker named volumes preserve local relay
history and Redis projection state between restarts.

The integration test publishes and queries signed events, restarts the relay underneath a live
subscription, and replays relay history twice into Redis. It does not contact a public relay.

## Production requirements

The deployment ticket must provide:

- a WSS relay endpoint with durable storage, backups, health checks, payload limits, connection and
  publish rate limits, and indexing enabled for kind `1701` plus the four tag filters;
- a relay query cap above 1,000 matching events and an operational alert before a single filter
  can exceed that many events in one timestamp second;
- Redis with authentication, TLS, persistence, backups, high availability, memory limits, and an
  explicit eviction policy that cannot discard projection keys;
- secret-managed relay and Redis URLs, network access restricted to the service, and separate
  environments with non-overlapping data;
- metrics and alerts for relay acknowledgement failures, reconnect duration, replay lag, invalid
  signatures, Redis errors, and duplicate idempotency keys;
- a shutdown grace period long enough to close subscriptions and Redis connections cleanly; and
- a final kind-registry collision check before public interoperability is announced.
