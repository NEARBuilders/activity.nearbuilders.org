# NEAR Builders Activity

`activity.nearbuilders.org` is a shared activity and reputation layer for the NEAR ecosystem.
Organizations register Activity Sources, define valid event types, and submit idempotent events to a
common HTTP gateway. Accepted events are signed with source-specific Nostr identities and exposed
through a verified feed, live updates, and dynamically weighted leaderboards.

## Core flow

1. A NEAR-authenticated organization registers an Activity Source.
2. A platform administrator reviews the source.
3. The source owner creates a signing identity, authorizes its NEAR binding, and creates an API key.
4. The source submits events to `POST /api/v1/events`.
5. The gateway validates, signs, and publishes the event to the configured Nostr relay.
6. Consumers query `/api/v1/events`, subscribe to `/api/v1/events/stream`, or view `/activity`.

## Properties

- Source-specific signatures make event provenance independently verifiable.
- Idempotency keys prevent duplicate submissions.
- Events stay immutable; moderation only suppresses them from service-controlled views.
- Current event weights and source trust multipliers are applied when leaderboards are read.
- Integrators use the HTTP API and do not need to operate Nostr directly.

## Public entry points

- `/activity` — verified activity feed and leaderboard
- `/activity-sources` — authenticated Activity Source management
- `/organizations` — authenticated workspace management
- `/README.md` — this overview
- `/skill.md` — integration guidance for agents
- `/llms.txt` — concise machine-readable context

The runtime extends `bos://dev.everything.near/dev.everything.dev` with local UI and API overrides.
The canonical implementation and operational documentation live in the repository root README and
`docs/` directory.
