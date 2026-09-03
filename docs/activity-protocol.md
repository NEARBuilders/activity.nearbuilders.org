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

`POST /api/v1/events` accepts JSON payloads up to 16 KiB after serialization. The gateway rejects
larger payloads before reserving an idempotency key, signing an event, or contacting the relay.

## Ingestion gateway

Send the Source API Key as a bearer credential and omit the source from the body; the gateway
derives the source from the credential:

```http
POST /api/v1/events
Authorization: Bearer act_<source-api-key>
Content-Type: application/json

{
  "eventType": "feedback.submitted",
  "actor": "alice.near",
  "idempotencyKey": "feedback:round-42:alice.near",
  "payload": { "rating": 5 }
}
```

A successful request returns `{ "eventId": "<64-character Nostr event ID>" }`. The Event Type must
be enabled for the authenticated Activity Source, the actor must be a valid NEAR account, and the
payload must be JSON within the 16 KiB limit.

Before signing, the gateway commits a durable reservation keyed by Activity Source and idempotency
key. It stores the signed event before relay publication and marks the reservation published only
after a positive relay acknowledgement. An identical completed retry returns the original event ID
without republishing. Different content under the same key returns `409 Conflict`. If relay
acknowledgement is lost, a retry republishes the same signed event ID, which relays and downstream
projections deduplicate.

The gateway returns `401 Unauthorized` for a missing, invalid, or revoked Source API Key; `400 Bad
Request` for an invalid actor, Event Type, or payload; `403 Forbidden` when the source or Signing
Identity cannot ingest; `409 Conflict` when an idempotency key is reused with different content; and
`503 Service Unavailable` when the relay does not positively acknowledge the signed event. A client
may safely retry the same request after a `503`.

## Public feed

`GET /api/v1/events` is public and accepts optional `source`, `type`, and `actor` filters. `limit`
defaults to 20 and may be between 1 and 100. Pass the returned opaque `nextCursor` unchanged to read
the following page:

```http
GET /api/v1/events?source=feedback-rounds&type=feedback.submitted&actor=alice.near&limit=20
```

The response contains `data` and pagination metadata:

```json
{
  "data": [
    {
      "id": "<64-character Nostr event ID>",
      "source": "feedback-rounds",
      "type": "feedback.submitted",
      "actor": "alice.near",
      "idempotencyKey": "feedback:round-42:alice.near",
      "timestamp": "2026-09-03T01:46:40.000Z",
      "payload": { "rating": 5 }
    }
  ],
  "meta": {
    "hasMore": false,
    "nextCursor": null,
    "skippedInvalid": 0
  }
}
```

The gateway verifies each event envelope, content hash, signature, required tags, and source-to-key
association against every bound Signing Identity retained for that source. Retired identities remain
trusted for historical events. Malformed, forged, mismatched, and filter-inconsistent relay records
are omitted before page boundaries are calculated. `skippedInvalid` makes those omissions observable
to clients. A malformed cursor returns `400 Bad Request`; a relay timeout or unsafe scan-limit result
returns `503 Service Unavailable` rather than leaving the request open or returning an incomplete
page.

## Transport boundary

The local boundary pins `nostr-tools@2.24.1`, `ws@8.21.3`, and `redis@6.2.1`, matching the transport
generation used by the released
[`@every-plugin/nostr@1.0.0`](https://github.com/NEARBuilders/nostr.nearbuilders.org/releases/tag/%40every-plugin%2Fnostr%401.0.0).
It supports relay `OK` acknowledgements, tag-filtered queries, live subscriptions, automatic
reconnection and resubscription, and explicit shutdown. No application plugin is imported yet;
the boundary is deliberately small enough to move behind the shared Nostr plugin when its public
contract includes the required streaming lifecycle.

## Source credentials and signing

Each approved Activity Source has one active Signing Identity. Its 32-byte Nostr private key is
encrypted with AES-256-GCM; the stored record contains ciphertext, a unique IV, an authentication
tag, and the version of the master key that encrypted it. The plaintext key is produced only inside
the signing operation and its buffer is cleared afterwards. API responses, errors, and safe history
records contain only the Nostr public key and binding metadata.

The deployment secret `ACTIVITY_SIGNING_MASTER_KEYS` is a JSON keyring whose values are base64
encoded 32-byte keys. `ACTIVITY_SIGNING_ACTIVE_KEY_VERSION` selects the key used for new encryption.
Old versions must remain available until every Signing Identity encrypted under them has been
rotated.

A Binding Proof follows the shared `near-nostr` convention. The gateway signs a kind-27235 challenge
with the custodied identity and prepares a mainnet `contextual.near.__fastdata_kv` write under
`nostr/<source-account>`. The connected wallet must use the Activity Source's exact mainnet NEAR
account. The wallet submits the transaction directly; no relayer is required. The gateway marks the
identity bound only after FastNear mainnet returns the same public key from that account's binding
path.

Source API keys contain 256 random bits and are persisted only as SHA-256 digests. They belong to
exactly one Activity Source and always carry the single `event:write` permission. The full secret is
returned by the creation response once; list and revoke responses contain safe metadata only. The
ingestion authentication boundary rejects revoked keys, unapproved sources, and sources without a
bound active Signing Identity.

Queries order events by `(created_at DESC, id DESC)`. The opaque cursor contains both values. Relay
queries include the cursor second, then discard IDs at or ahead of the cursor locally, preventing
events with the same Nostr timestamp from being skipped or repeated. Each relay scan requests up to
1,000 matching records and exposes pages of at most 100 records. A response that reaches the scan
limit fails loudly instead of returning a cursor that could silently omit same-second events.
Relay reads have a six-second gateway deadline around the relay client's five-second wait.

## Local workflow

Start the pinned relay and Redis services, run the integration proof, and stop the services with:

```bash
bun run dev:activity-infra
bun run test:activity
bun run dev:activity-infra:down
```

Defaults are `ws://127.0.0.1:7447` for the relay and `redis://127.0.0.1:6379` for Redis. Override
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
