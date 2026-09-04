# Activity Service

`activity.nearbuilders.org` is a shared activity and reputation layer for the NEAR ecosystem. Activity Sources are registered through a NEAR-authenticated organization and, as the service grows, will receive API credentials for submitting events through a common HTTP gateway. The service is designed to give applications a portable event feed, live updates, and dynamically scored leaderboards without requiring every integrator to build the same infrastructure.

This repository extends [`dev.everything`](https://everything.dev/) with local UI and API overrides. It includes the local Nostr/Redis protocol proof, Activity Source registration and approval, source credentials, exactly-once event ingestion, a public filtered Activity feed with resumable live streaming, administrator-controlled event suppression, and dynamically weighted leaderboards.

The product scope comes from [NEAR Builders' Activity Service proposal](https://github.com/NEARBuilders/nearbuilders.org/blob/main/ACTIVITY.md), originally targeted for August 2026.

## Why this exists

Activity data is fragmented across NEAR applications. Games, governance tools, community platforms, and developer tooling each track engagement independently, so contributors cannot carry a useful history between applications and every new integration starts from zero.

The Activity Service provides one integration path for all of them:

- Organizations own stable Activity Source identities associated with NEAR accounts.
- API keys authenticate event submissions.
- Per-source Nostr keys provide cryptographic provenance.
- Nostr relays store and distribute immutable events.
- Redis stores raw counts and calculates scores using current point values.
- HTTP queries and SSE expose historical and real-time activity to clients.

The service is intended to become shared plumbing for reputation, loyalty points, wallet personalities, builder footprints, and future polling integrations.

## Product principles

- **Portable:** activity belongs to the actor and can be consumed across applications.
- **Source-verifiable:** every displayed event is attributable to the registered Signing Identity that signed it.
- **Immutable:** accepted events are never edited; administrators may only hide them.
- **Idempotent:** repeat submissions produce the same immutable event identity.
- **Dynamically scored:** point-value changes affect historical leaderboard results immediately, without replaying events.
- **Simple to adopt:** external integrators use an HTTP API and do not need to operate Nostr directly.

## Current and planned API

| Method | Endpoint | Status | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v1/events` | Available | Submit an event using a Source API Key. |
| `GET` | `/api/v1/events` | Available | Query signature-verified events by source, type, actor, limit, and opaque cursor. |
| `GET` | `/api/v1/events/stream` | Available | Subscribe to new events over resumable SSE, optionally filtered by source, type, or actor. |
| `POST` | `/api/activity/events/{eventId}/hide` | Available (admin) | Hide an immutable event from service-controlled public views. |
| `GET` | `/api/activity/hidden-events` | Available (admin) | Inspect hidden events and their moderation history. |
| `POST` | `/api/activity/sources/{sourceId}/trust` | Available (admin) | Set an auditable source trust designation and score multiplier. |
| `PUT` | `/api/activity/sources/{sourceId}/github` | Available (owner) | Configure public repositories, event types, and GitHub-to-NEAR actor mappings. |
| `POST` | `/api/activity/sources/{sourceId}/github/poll` | Available (owner) | Run the configured GitHub poller immediately. |
| `GET` | `/api/v1/leaderboard` | Available | Read exact weekly, monthly, or all-time rankings with optional source and Event Type filters. |

### Event shape

Each event contains:

- `source`: the approved source ID managed through the dashboard
- `type`: a source-defined event type
- `actor`: the NEAR account receiving attribution
- `payload`: arbitrary JSON associated with the activity
- an idempotency key scoped to the source, such as `github:pr:42`

The gateway validates the source and event type, signs the event with the Activity Source's Nostr key, publishes it to configured relays, and returns its immutable event ID.

Public consumers can browse signature-verified events at `/activity` or call `GET /api/v1/events`.
Results are ordered newest-first by timestamp and event ID. Only events signed by a Signing Identity
registered to their tagged Activity Source—and active when the event was signed—are returned. Each
event exposes its signing public key, whether that identity is active or retired, the source's current
trust designation and multiplier, and an explicit reminder that cryptographic provenance does not
independently verify claims inside the payload.

Platform administrators can hide a verified event without changing or deleting its signed Nostr
record. A local suppression projection removes the event from feed queries, live delivery, and SSE
replay. The first hide and every distinct moderation request are retained for audit, while
idempotency keys prevent request retries from applying the projection more than once.

Source approval controls whether a source may ingest events. Separately, a Platform Administrator
may designate an approved or pending source as trusted and configure its score multiplier, with an
append-only reasoned audit trail. The administrator dashboard exposes these controls and the trust
history independently of the approval queue. Leaderboard queries rank actors from raw per-source and
per-Event-Type Redis counts, then apply both the current point value and current source multiplier.
Changing either value therefore changes historical rankings on the next response without replaying
relay history. Weeks begin Monday at 00:00 UTC, months begin on the first day at 00:00 UTC, and
all-time counts have no expiry boundary. See
[`docs/activity-leaderboard.md`](docs/activity-leaderboard.md) for storage, rebuild, and benchmark
details.

## Proposed architecture

```text
Activity Source (NEAR account)
    |
    | POST /api/v1/events (API key)
    v
HTTP gateway
    | validates the key and event type
    | signs with the source's encrypted Nostr key
    v
Nostr relays
    | persist and distribute immutable events
    v
Activity service
    | updates Redis counts
    | computes count x current point value
    | streams new events over SSE
    v
Activity UI and external consumers
```

### Nostr

Activity events use regular, immutable Nostr kind `1701`. Each registered Activity Source will receive or link its own Nostr keypair so its events can be verified independently. Private signing keys will be encrypted at rest with AES-256, decrypted only while signing, and never returned by the API.

Rotating a source key affects only new signatures. Historical relay events are checked against the
identity active at their signing time and remain valid, while rotation actors and reasons are retained
for audit. Actor-based Redis counts and leaderboard history continue without a rebuild.

The service depends on the shared NEAR-to-Nostr work:

- `nostr-core` for relay communication
- `near-nostr` for linking NEAR accounts to Nostr public keys
- a reliable configured relay for the initial deployment

### Redis and scoring

Redis stores raw event counts rather than precomputed scores:

```text
counts:{period}:{actor} -> Hash { '["game.near","score"]': 42 }
active:{period}         -> Sorted Set of actors by total event count
```

Leaderboard reads multiply counts by each event type's current point value and then rank actors. Weekly and monthly keys expire by TTL; all-time counts remain. This makes point-value changes retroactive on the next read with no rebuild.

## User flows

### Activity Source onboarding

1. A Source Owner authenticates with NEAR and selects the owning organization.
2. The owner registers an Activity Source and defines valid Event Types.
3. A Platform Administrator approves or rejects the source with an auditable reason.
4. The source creates or links a Nostr signing identity.
5. The source creates an API key.
6. It starts submitting events to `POST /api/v1/events`.

Approved Source Owners manage credentials from the Activity Sources page. Creating a Signing
Identity returns only its Nostr public key; its private key is encrypted by the gateway. The owner
must connect the Activity Source's exact mainnet NEAR account and authorize the prepared FastNear
KV binding before creating a Source API Key. This is a direct wallet
transaction, so it does not require a configured relayer. A new API-key secret is shown once, while
later views expose only its name, prefix, `event:write` permission, timestamps, and revocation state.

### Event delivery

1. The gateway authenticates the API key and validates the event.
2. It signs the event with the source's Nostr key.
3. It publishes the event to the configured relay and returns its event ID.
4. The activity subscriber updates Redis counts.
5. Connected clients receive the event through SSE.
6. Feed and leaderboard queries reflect the new activity.

### GitHub polling

An approved Source Owner can enable GitHub polling from the Activity Sources page after adding
`github.pr.merged` and/or `github.issue.closed` to the source's Event Types. Repositories are public
`owner/repository` values, and every GitHub author must be explicitly mapped to the NEAR account
that receives credit. Unmapped events remain quarantined until a mapping is added. The worker
persists ETags and GitHub poll intervals across restarts, while object-based idempotency keys prevent
duplicate Activity events. See [`docs/activity-protocol.md`](docs/activity-protocol.md) for polling,
rate-limit, and backfill boundaries.

## Initial delivery scope

- Configure one reliable Nostr relay and define the activity event kind.
- Provide relay-backed event ingestion and filtered event queries.
- Register Activity Sources through NEAR-authenticated organizations and approve them through an admin dashboard.
- Create and revoke API keys and securely manage per-source Nostr keys.
- Stream new events to clients through filtered SSE subscriptions.
- Add provenance and verification signals to leaderboard entries.
- Show source badges and distinguish verified from unverified events.
- Let signed-in users endorse public events and remove their endorsement.
- Support hiding immutable events through moderation controls.
- Register one external polling integration, initially a GitHub activity poller.
- Migrate nearbuilders.org activity emission from its existing Postgres plugin to the gateway.
- Surface activity on builder profiles and the projects board.
- Publish an onboarding guide that an external project can follow without assistance.

No application plugins are imported in this scaffold yet.

## Out of scope for the initial release

- On-chain event indexing for the Wallet Personality Engine
- A points redemption marketplace
- A complete cross-ecosystem trust-passport product
- Per-source application rate limiting beyond relay-level protection

These can later integrate through the same event gateway without changing the core model.

## Success measures

- Three external Activity Sources are registered and submitting events.
- One polling integration appears in the live feed with a source badge.
- Activity is visible on builder profiles and the projects board.
- Weekly, monthly, and all-time leaderboards are live.
- An external integrator can complete onboarding without direct assistance.
- The Nostr infrastructure is reusable by both activity and chat scopes.

## Local development

### Requirements

- [Bun](https://bun.sh/)
- Docker with Compose

### Start the service

```bash
bun install
bun run dev:activity-infra
bun run dev
```

The initializer creates a local `.env` from `.env.example`. Keep secrets out of version control.
The Activity infrastructure command starts the pinned local Nostr relay on port `7447` and Redis
on port `6379`; both use Docker named volumes. Run `bun run dev:activity-infra:down` to stop them.

Local development uses a deterministic signing master key only when
`ACTIVITY_SIGNING_MASTER_KEYS` is empty. Every deployed environment must provide a JSON keyring of
base64-encoded 32-byte keys and select its current version:

```dotenv
ACTIVITY_SIGNING_MASTER_KEYS={"v1":"<base64-encoded-32-byte-key>"}
ACTIVITY_SIGNING_ACTIVE_KEY_VERSION=v1
ACTIVITY_GITHUB_TOKEN=
```

To rotate the encryption master key, retain previous entries for decryption and point the active
version at the new entry. Signing Identity rotation is separate: it retires the old public identity,
creates a new encrypted one, and requires a new NEAR binding without modifying historical events.

Binding uses `contextual.near` with FastNear mainnet. The contract ID and FastNear endpoint are
explicit API variables in `bos.config.json`; local API-only runs may override them with
`ACTIVITY_NOSTR_BINDING_CONTRACT` and `ACTIVITY_NOSTR_KV_API_URL`.

### Useful commands

```bash
bun run typecheck
bun run test
bun run test:activity
bun run lint
bun run build
```

The Activity integration test uses only the local containers and includes a real relay restart.
The event kind, indexed tags, cursor contract, and production requirements are documented in
[`docs/activity-protocol.md`](./docs/activity-protocol.md).

Runtime composition is configured in [`bos.config.json`](./bos.config.json). The project publishes from `nearbuilding.near`, serves `activity.nearbuilders.org`, and inherits the shared runtime from `dev.everything` while overriding the UI and API locally.

## Repository layout

```text
api/               Activity API and service implementation
ui/                Activity dashboard, feed, and leaderboard UI
bos.config.json    everything.dev runtime composition
compose.activity.yml Local Nostr relay and Redis infrastructure
```

See [`AGENTS.md`](./AGENTS.md) for repository-specific development guidance and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the contribution workflow.
