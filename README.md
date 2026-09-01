# Activity Service

`activity.nearbuilders.org` is a shared activity and reputation layer for the NEAR ecosystem. Projects register with a NEAR account, receive an API key, and submit activity events through a common HTTP gateway. The service gives applications a portable event feed, live updates, and dynamically scored leaderboards without requiring every project to build the same infrastructure.

This repository extends [`dev.everything`](https://everything.dev/) with local UI and API overrides. It is currently an initialized application scaffold; the activity features described below are the implementation scope, not a claim that they are already live.

The product scope comes from [NEAR Builders' Activity Service proposal](https://github.com/NEARBuilders/nearbuilders.org/blob/main/ACTIVITY.md), originally targeted for August 2026.

## Why this exists

Activity data is fragmented across NEAR applications. Games, governance tools, community platforms, and developer tooling each track engagement independently, so contributors cannot carry a useful history between projects and every new application starts from zero.

The Activity Service provides one integration path for all of them:

- Projects own their source identity through a NEAR account.
- API keys authenticate event submissions.
- Per-project Nostr keys provide cryptographic provenance.
- Nostr relays store and distribute immutable events.
- Redis stores raw counts and calculates scores using current point values.
- HTTP queries and SSE expose historical and real-time activity to clients.

The service is intended to become shared plumbing for reputation, loyalty points, wallet personalities, builder footprints, and future polling integrations.

## Product principles

- **Portable:** activity belongs to the actor and can be consumed across projects.
- **Source-verifiable:** every event is attributable to an approved project identity.
- **Immutable:** accepted events are never edited; administrators may only hide them.
- **Idempotent:** repeat submissions produce the same immutable event identity.
- **Dynamically scored:** point-value changes affect historical leaderboard results immediately, without replaying events.
- **Simple to adopt:** external projects integrate through an HTTP API and do not need to operate Nostr directly.

## Planned API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/events` | Submit an event using an API key. |
| `GET` | `/api/v1/events` | Query events by source, type, actor, limit, and cursor. |
| `GET` | `/api/v1/events/stream` | Subscribe to new events over SSE, optionally filtered by source, type, or actor. |
| `GET` | `/api/v1/leaderboard` | Read weekly, monthly, or all-time rankings. |

### Event shape

Each event contains:

- `source`: the approved source ID managed through the dashboard
- `type`: a source-defined event type
- `actor`: the NEAR account receiving attribution
- `payload`: arbitrary JSON associated with the activity
- an idempotency key scoped to the source, such as `github:pr:42`

The gateway validates the source and event type, signs the event with the project's Nostr key, publishes it to configured relays, and returns its immutable event ID.

## Proposed architecture

```text
Project (NEAR account)
    |
    | POST /api/v1/events (API key)
    v
HTTP gateway
    | validates the key and event type
    | signs with the project's encrypted Nostr key
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

Activity events will use a dedicated Nostr event kind. Each registered project receives or links its own Nostr keypair so its events can be verified independently. Private signing keys are encrypted at rest with AES-256, decrypted only while signing, and never returned by the API.

Rotating a project key affects only new signatures. Historical relay events remain valid, while actor-based Redis counts and leaderboard history continue without a rebuild.

The service depends on the shared NEAR-to-Nostr work:

- `nostr-core` for relay communication
- `near-nostr` for linking NEAR accounts to Nostr public keys
- a reliable configured relay for the initial deployment

### Redis and scoring

Redis stores raw event counts rather than precomputed scores:

```text
counts:{period}:{actor} -> Hash { "game.score": 42, "github.pr": 15 }
active:{period}         -> Sorted Set of actors by total event count
```

Leaderboard reads multiply counts by each event type's current point value and then rank actors. Weekly and monthly keys expire by TTL; all-time counts remain. This makes point-value changes retroactive on the next read with no rebuild.

## User flows

### Project onboarding

1. A project signs in with its NEAR account.
2. It registers an activity source and defines valid event types.
3. An administrator approves or rejects the source.
4. The project creates or links a Nostr signing identity.
5. The project creates an API key.
6. It starts submitting events to `POST /api/v1/events`.

### Event delivery

1. The gateway authenticates the API key and validates the event.
2. It signs the event with the source's Nostr key.
3. It publishes the event to the configured relay and returns its event ID.
4. The activity subscriber updates Redis counts.
5. Connected clients receive the event through SSE.
6. Feed and leaderboard queries reflect the new activity.

## Initial delivery scope

- Configure one reliable Nostr relay and define the activity event kind.
- Provide relay-backed event ingestion and filtered event queries.
- Register projects through NEAR authentication and approve sources through an admin dashboard.
- Create and revoke API keys and securely manage per-project Nostr keys.
- Stream new events to clients through filtered SSE subscriptions.
- Build weekly, monthly, and all-time leaderboards from Redis counts and dynamic point values.
- Show source badges and distinguish verified from unverified events.
- Connect public event upvotes and downvotes through the existing votes service.
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

- Three external projects are registered and submitting events.
- One polling integration appears in the live feed with a source badge.
- Activity is visible on builder profiles and the projects board.
- Weekly, monthly, and all-time leaderboards are live.
- An external project can complete onboarding without direct assistance.
- The Nostr infrastructure is reusable by both activity and chat scopes.

## Local development

### Requirements

- [Bun](https://bun.sh/)
- Docker with Compose

### Start the project

```bash
bun install
docker compose up -d --wait
bun run dev
```

The initializer creates a local `.env` from `.env.example`. Keep secrets out of version control.

### Useful commands

```bash
bun run typecheck
bun run test
bun run lint
bun run build
```

Runtime composition is configured in [`bos.config.json`](./bos.config.json). The project publishes from `nearbuilding.near`, serves `activity.nearbuilders.org`, and inherits the shared runtime from `dev.everything` while overriding the UI and API locally.

## Repository layout

```text
api/               Activity API and service implementation
ui/                Activity dashboard, feed, and leaderboard UI
bos.config.json    everything.dev runtime composition
docker-compose.yml Local infrastructure
```

See [`AGENTS.md`](./AGENTS.md) for project-specific development guidance and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the contribution workflow.
