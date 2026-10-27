# @every-plugin/nostr

A `createPlugin` for the [everything.dev](https://github.com/nearbuilders/everything-dev) runtime that exposes Nostr ↔ NEAR identity bindings and relay-backed comment threads.

## What it provides

| Route group | Endpoints |
| --- | --- |
| Identity & health | `listRelays`, `ping` |
| FastNear KV binding | `getBinding`, `getIdentity`, `createChallenge`, `verifyBinding`, `prepareBindingWrite` |
| Relay-backed comments | `listComments`, `createComment`, `listChannels`, `queryEvents`, `subscribeEvents`, `publishEvent`, `getProfile` |

Binding events are kind-27235 (a NEAR-convention kind; verified server-side, proof lands on-chain in FastNear KV, never published to relays); comment events are kind-1111 + legacy kind-1 (standard) or kind-9 + channel meta events (buzz).

## Service architecture

```
BindingService          (src/services/binding.ts)
└── Context.Tag + Layer.effect over NostrConfigTag
    Reads FastNear KV via src/lib/fastnear-kv.ts

NostrCommentService     (src/services/nostr.ts)
└── Context.Tag + Layer.scoped over StandardAdapterService
    Consumes StandardAdapterService via Layer.provide

StandardAdapterService  (src/nostr-core/adapters/standard-service.ts)
└── Context.Tag + Layer.scoped with Effect.addFinalizer for pool close
    Wraps nostr-tools SimplePool

BuzzAdapter             (src/nostr-core/adapters/buzz.ts)
└── Plain class, constructed by NostrCommentService when BUZZ_NSEC is configured
    NIP-42 relay auth + per-publish OK await
```

## Configuration

Variables (`bos.app.ts` → `plugins.nostr.variables`; `plugin.dev.ts` for standalone dev):

| Variable | Default | Notes |
| --- | --- | --- |
| `relays` | 3 public relays | Standard relay pool for raw reads, publishing, streaming, comments, and profiles |
| `clientName` | `nostr.nearbuilders.org` | Tag attached to published events |
| `STANDARD_RELAYS` | unset | Legacy comma-separated override for the standard relay pool; takes precedence over `relays` |
| `BUZZ_RELAYS` | `wss://nearbuilders.communities.buzz.xyz` | Buzz-specific relays |
| `KV_API_URL` | `https://kv.main.fastnear.com` | FastNear KV base URL |
| `BINDING_CONTRACT` | `contextual.near` | Contract account hosting the KV table |
| `CHALLENGE_EXPIRY_SECONDS` | `300` | TTL of a `bind:<account>:<expiry>:<label>` challenge |

Secrets:

| Secret | Required for | Format |
| --- | --- | --- |
| `BUZZ_NSEC` | buzz adapter | `nsec1...` or 64-char hex |

Misconfigured `BUZZ_NSEC` fails the plugin at initialize (fail-fast, not silent degradation).

## Development

```bash
pnpm install
pnpm run dev                       # bos dev, from the repo root
pnpm --dir plugins/nostr run test  # vitest
pnpm --dir plugins/nostr run typecheck
pnpm run lint
```

## Tests

`plugins/nostr/tests/` — 38 vitest tests covering key derivation, kind-27235 signing + tamper detection, KV read paths (mocked fetch), and challenge verification. Shared fixtures in `tests/helpers.ts`.

## Module structure

```
plugins/nostr/
├── src/
│   ├── contract.ts               ORPC routes (Zod inputs/outputs)
│   ├── index.ts                  createPlugin wiring + handlers
│   ├── lib/
│   │   ├── auth.ts               framework-owned, synced via bos sync
│   │   ├── context.ts            framework-owned, synced via bos sync
│   │   ├── fastnear-kv.ts        cfg-driven FastNear KV read client
│   │   ├── nostr-config.ts       Zod schemas + Context.Tag + resolveNostrConfig
│   │   └── schemas.ts            shared Zod schemas + z.infer for wire types
│   ├── nostr-core/
│   │   ├── adapters/             RelayAdapter implementations + standard-service.ts
│   │   ├── core.ts               nostr-tools SimplePool wrapper (vendored)
│   │   ├── signers/              LocalSigner (vendored)
│   │   └── types.ts              NostrEvent re-exported from nostr-tools/core
│   └── services/
│       ├── binding.ts            BindingService
│       ├── key-derivation.ts     NEAR-account-derived Nostr keys
│       └── nostr.ts              NostrCommentService
└── tests/
```

## Raw signed events and Activity integration

`publishEvent` accepts an already-signed Nostr event without a user session or API
key. The plugin validates its content-derived ID and signature and publishes that
same event; it never receives the source's private key. `createComment` and NEAR
binding mutations still require the existing user authentication.

Raw operations use the effective standard relay pool reported by `listRelays`.
An optional request `relays` list must be a non-empty subset of that configured
pool. Configure between one and ten `ws://` or `wss://` URLs. `STANDARD_RELAYS`,
when explicitly set, overrides `relays` for compatibility. Previously the reported
pool could differ from the actual pool; it now reports the effective destinations.
Unconfigured per-request destinations are rejected. Signed event envelopes are
limited to 64 KiB. Operators still own host traffic limits and relay write policy.

Publishing returns an acknowledgement status for each relay. A valid signature is
not a guarantee that a relay accepts the event. Callers must check `success` on
the intended durable relay before committing their submission. The plugin does
not perform NIP-42 relay authentication on behalf of an event author.

`queryEvents` accepts kinds, exact IDs/authors, inclusive `since`/`until`, and
single-letter tag filters, including Activity's `s`, `t`, `n`, and `i`. Multiple
values for one tag are alternatives; different tags are combined. The limit is
0–1,000 and defaults to 1,000. Results are deduplicated and ordered by descending
timestamp and ascending ID for timestamp ties, following NIP-01.

A query waits for each selected relay's EOSE and fails with `RELAY_TIMEOUT` (504)
or `RELAY_UNAVAILABLE` (503) on a deadline or early close, rather than returning
partial results as success. `meta.limited` is true if a relay reaches the requested
limit or the merged results exceed it. This is not an exhaustive-history guarantee:
relays can impose lower caps, omit history, or expire it. Activity must use a relay
with known retention and capacity and retain its own cursor/provenance checks.

`subscribeEvents` accepts the same filters and returns an oRPC event iterator:

```ts
const controller = new AbortController();
const events = await apiClient.nostr.subscribeEvents(
  {
    filter: {
      kinds: [1701],
      since: resumeTimestamp,
      tags: [{ tag: "s", values: [sourceId] }],
    },
  },
  { signal: controller.signal },
);

for await (const event of events) {
  await processEvent(event);
}
```

Without `since`, subscriptions begin at the current second. `limit: 0` skips the
initial history; the limit never caps live delivery. Relay disconnects reconnect
with backoff (250 ms up to 5 seconds), replaying the missed interval with up to
30 seconds of overlap. Recovery uses local receipt time, so a future-dated event
cannot advance the replay boundary. Duplicate IDs are suppressed across relays and
reconnects. Initial/recovery history reaching its cap, a 1,000-event consumer queue,
or 10,000 retained IDs ends the stream with `RELAY_LIMIT` (503); persist a replay
boundary and reopen after handling the cause. Relay policy rejections and replay
timeouts are surfaced explicitly. Cancellation and plugin shutdown stop subscriptions
and reconnect timers; shutdown destroys the connection pool.

Timestamp replay cannot recover arbitrarily backdated events, relay-expired events,
or history beyond a relay's own cap. A new client connection or plugin process must
supply its persisted `since`; the plugin does not persist a cross-process resume
cursor. Activity continues to own public SSE `Last-Event-ID`, source approval,
NEAR binding history, signing custody, durable source-scoped idempotency, scoring,
and moderation. Its original scope requires an operated production relay; the
public defaults do not replace that infrastructure.

See [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) for event,
filter, acknowledgement, and EOSE semantics, and
[NIP-42](https://github.com/nostr-protocol/nips/blob/master/42.md) for optional relay
authentication.

Run `pnpm run test` for source/runtime and HTTP tests against local WebSocket relays.
Run `pnpm run test:bundle` to build and load the actual Module Federation artifact,
then prove publishing, queries, streaming, and cleanup. The bundle test registers
the package's canonical remote name (`@every-plugin/nostr`), matching the emitted
container, and exercises the bundled `ws` implementation without native addons.
