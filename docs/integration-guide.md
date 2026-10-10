# Integrate with Activity

## What Activity is

Activity is a shared record of what people do across the NEAR ecosystem. Your project reports an
event — someone submitted feedback, merged a pull request, completed a task — and Activity signs it
with your project's own key, publishes it to a Nostr relay, and makes it publicly verifiable.
Accepted events are never edited or deleted.

## Why integrate

**Reputation stops resetting.** A user who has proven themselves in another app arrives at yours
with that history intact, and what they do in yours carries forward to the next one. Every project
integrating makes the record more useful for all of them.

**You get scoring, leaderboards, and a live feed without building any of it.** Define your own event
types and what each is worth. Read history back with a public API, or subscribe to a live stream.

**The record holds up.** Events are cryptographically signed and tied to your project's identity, so
what you report is a verifiable reference rather than a claim.

## What it costs

A plain HTTP request per event. No library to install, no infrastructure to run. Registration takes
one on-chain transaction that costs about **0.0001 NEAR** in gas, with no deposit; after that you are
sending events. An administrator reviews the source in the background, so you never wait on them.

---

This guide takes an external project from registration to a verified event, live updates, and a
leaderboard result. The HTTP examples use `https://activity.nearbuilders.org/api`; if you are
running Activity locally, replace it with `http://localhost:3000/api`.

## Before you start

**Activity is a plain HTTP API.** You can authenticate with a bearer token and send JSON without
installing a package. You do not need to run Nostr or Redis yourself. A typed oRPC client is also
available in this repository; see [Use a typed client](#11-use-a-typed-client).

You will need:

- A **mainnet NEAR account** for the source. One on-chain transaction from this exact account links
  it to the source's signing key. It attaches no deposit and costs about **0.0001 NEAR** in gas, so
  any account holding **0.01 NEAR** has plenty. One NEAR account can own up to 10 sources, each
  linked separately.
- An **organization** in Activity that you own.

Budget for this realistically. Sending your first event once you hold an API key takes a couple of
minutes:

| Step | Who | How long |
| --- | --- | --- |
| Register the source | You | Minutes |
| Link the source on-chain | You, from the source's NEAR account | One wallet approval, then seconds |
| Create an API key and publish | You | Minutes |
| Review the source | A Platform Administrator | In the background; it does not block you |

> **Events are accepted before approval.** Until a Platform Administrator approves the source, its
> events appear in the feed marked **Under review**, do not count on leaderboards, and are limited to
> 500 per day. Approval lifts the limit and counts earlier events too. A rejected source cannot
> publish, and its events leave the feed.

Once you are publishing, this is what happens to an event:

```text
  your server
      │  POST /v1/events   (Authorization: Bearer act_…)
      ▼
  Activity gateway
      │  checks the key, the source, and the Event Type
      │  reserves the idempotency key, so a retry cannot duplicate
      │  signs the event with your source's own Nostr key
      ▼
  Nostr relay ──────────── immutable, signed, publicly verifiable
      │
      ├──────────────► feed and live stream readers
      └──────────────► Redis counts ──► leaderboards
```

Activity never edits or deletes an accepted event. Everything you read back later — the feed, the
live stream, the leaderboard — is derived from that signed record.

## Set it up with a coding agent

The fastest path is to ask your coding agent: *"Integrate activity.nearbuilders.org in this project,
it's https://nearbuilders.org/projects/your-project."* Point it at
[`/skill.md`](https://activity.nearbuilders.org/skill.md) if it does not find it on its own. The
agent prepares everything; you sign in and approve one wallet transaction.

**What you do:**

1. Your agent shows you a link to `/binding?sessionToken=…` and a short match code such as
   `7VQ-9SP`.
2. Open the link and sign in with your NEAR wallet. Check that the page shows the **same match
   code**. If it does not, close the page: someone else started that session.
3. If you do not own an organization yet, choose **Create "<project>"** to make one named after the
   project.
4. Check the details the agent filled in, adjust anything, and register the source.
5. Approve the link transaction in your wallet. The page then says **Return to your agent**.

**What the agent does:** it starts a binding session, waits while you finish, receives the Source
API Key, stores it as a server-side secret, writes the integration, and sends a test event. The key
goes straight to the agent and is never shown on the page.

### Binding session API

Start a session. Every field is optional; `project.reference` accepts a nearbuilders.org project
link, slug, `proj_…` id, or name, and fills in the Source ID, display name, and NEAR account from
the project. Fields you send yourself take precedence over the project's.

```bash
curl -sS -X POST https://activity.nearbuilders.org/api/v1/binding-sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "project": { "reference": "https://nearbuilders.org/projects/your-project" },
    "eventTypes": [
      { "name": "task.completed", "description": "A user completed a task", "enabled": true, "pointValue": 5 }
    ]
  }'
```

The response contains `url` (give it to the person), `matchCode` (show it to them), `pollToken`
(keep it private), `sessionId`, `expiresAt`, and the resolved `draft`. The person has 30 minutes to
finish. A caller can start 10 sessions per 10 minutes; more return `429`. An ambiguous project name
returns `400` listing the matching project links, and an unknown project returns `404`.

Claim the key with the poll token:

```bash
curl -sS -X POST "https://activity.nearbuilders.org/api/v1/binding-sessions/$SESSION_ID/claim" \
  -H "Authorization: Bearer $POLL_TOKEN" -H 'Content-Type: application/json' -d '{}'
```

| `status` | Meaning | Next step |
| --- | --- | --- |
| `waiting` | The person has not finished yet | Poll again in a few seconds. |
| `ready` | Finished; the response includes `secret` (the `act_…` key), `apiKeyId`, and `sourceId` | Store the secret now. It is returned only this once. |
| `claimed` | The key was already returned | Use the stored key, or create a new one on `/activity-sources`. |
| `expired` | The person did not finish in time, or the key was not claimed within 24 hours | Start a new session. |

A wrong or missing poll token returns `404` or `401`. The source starts **Under review**: its events
are accepted and appear in the feed straight away, and count on leaderboards once a Platform
Administrator approves it.

## 1. Register a source

Everything in this section happens in the browser, and it is the only part that needs a NEAR
wallet. Before starting, have the **mainnet NEAR account that will own the source**, holding at
least **0.01 NEAR**; the one transaction below costs about 0.0001 NEAR.

`/activity-sources` walks you through these steps with a setup panel at the top of the page. It
shows which step you are on (**Info**, **Link on-chain**, **API key**) and puts that step's button
or form right inside it. Once the source is registered, **Edit info** takes you back to change its
details; the Source ID stays fixed.

1. **Sign in** with that NEAR account.
2. **Select or create an organization** in the workspace menu. You must be its **owner**: members
   cannot register sources or manage credentials. A source belongs to one organization permanently.
3. **Register the source** on `/activity-sources`. Search for your project in **Find your project on
   nearbuilders.org**, or paste its link, and pick it to fill in the first three fields; projects you
   own are marked **Owned**. Not on nearbuilders.org? Choose **Enter manually**. A nearbuilders.org
   project can have only one source, and only the project owner's NEAR account (or the project's
   linked app account) can register it, signed in as that account.
   - **Source ID** — lowercase, permanent, and shown publicly on every event, such as
     `github.nearbuilders.org`. It cannot be changed later.
   - **Display name** — shown on feed cards.
   - **NEAR account** — the exact mainnet account that will sign the on-chain link in step 5. It
     must be linked to your profile, and **Register source** stays disabled until it is. For a
     nearbuilders.org project it is filled with the project owner's account. One account can own up
     to 10 sources.
   - **Event Types** — at least one, lowercase, such as `feedback.submitted`. Each carries a point
     value used for scoring, an optional description, and can be enabled or disabled. Add every
     type you expect to publish; submitting a type that is missing or disabled returns `400`.
4. **Keep going while it is reviewed.** A Platform Administrator approves or rejects with a written
   reason, which you can see on the source. You do not wait for it: until approval, your events are
   accepted and marked **Under review**. Approval is what puts them on leaderboards. The separate
   `standard` or `trusted` designation only affects scoring weight, and you do not need `trusted` to
   start.
5. **Link on-chain.** Choose **Approve in wallet** and approve the mainnet transaction **from the
   source's exact NEAR account**; if you are signed in as a different account, the panel tells you
   which one to use. Activity first creates the source's signing identity, a Nostr keypair whose
   private key is encrypted at rest and never shown or exported. The transaction then writes the
   link between the NEAR account and that key on-chain. It attaches no deposit, costs about 0.0001
   NEAR, and goes directly through your wallet, so no relayer is involved. The panel waits for it
   to be indexed and moves on by itself. Until this succeeds, publishing returns `403`.
6. **Create your API key.** Copy the `act_…` value immediately: it is shown once, and afterwards
   only its name, prefix, and timestamps are visible. The panel also gives you a ready-to-run
   `curl` command for your first event, filled in with your key, account, and Event Type.

> **Treat the Source API Key as a server-side credential.** Store it in your deployment platform's
> encrypted secret manager. Never put it in source code, client-side JavaScript, logs, screenshots,
> issue bodies, `.env.example`, or a committed `.env`.

> **Editing a source later sends it back for review.** Changing the display name, NEAR account, or
> Event Types returns the source to `pending`: it keeps ingesting, but its events are marked
> **Under review** and leave leaderboards until an administrator reviews it again. Changing the NEAR
> account also unbinds the Signing Identity, so step 5 has to be repeated from the new account.
> Plan your Event Types up front where you can.

### Polling GitHub instead of publishing

An approved source can have Activity poll public GitHub repositories for it, rather than calling
the API itself. Add `github.pr.merged` and/or `github.issue.closed` as Event Types, then configure
repositories on the source. Every GitHub login must be explicitly mapped to the NEAR account that
should receive credit; events from unmapped authors are quarantined until a mapping exists rather
than being attributed to the wrong person. See
[`activity-protocol.md`](activity-protocol.md#github-repository-polling) for polling intervals,
rate limits, and backfill boundaries.

## 2. Run the typed example

[`examples/activity-client.ts`](../examples/activity-client.ts) is dependency-free TypeScript built
on the standard Fetch, Web Streams, and AbortSignal APIs. It submits an event, repeats the exact
request, proves both calls return the same event ID, queries the event, receives a second event over
SSE, and reads the all-time leaderboard.

Run the wrapper from this repository:

```bash
ACTIVITY_API_BASE_URL=https://activity.nearbuilders.org/api \
ACTIVITY_API_KEY='act_REPLACE_WITH_SECRET' \
ACTIVITY_SOURCE_ID='your-source' \
ACTIVITY_EVENT_TYPE='feedback.submitted' \
ACTIVITY_ACTOR='alice.near' \
ACTIVITY_EXAMPLE_RUN_ID='local-001' \
bun examples/run-activity-example.ts
```

The configured source must have the selected Event Type enabled. Keep `ACTIVITY_EXAMPLE_RUN_ID`
stable when retrying the same run. The program prints only event IDs and scoring results; it never
prints the API key.

To use the client in another TypeScript project, copy the example file or adapt its small
`ActivityClient` class. The essential submission is:

```ts
import { ActivityClient } from "./activity-client";

const activity = new ActivityClient({
  apiBaseUrl: process.env.ACTIVITY_API_BASE_URL!,
  apiKey: process.env.ACTIVITY_API_KEY!,
});

const request = {
  eventType: "feedback.submitted",
  actor: "alice.near",
  idempotencyKey: "feedback:round-42:alice.near",
  payload: { rating: 5 },
};

const first = await activity.submit(request);
const retried = await activity.submit(request);
```

`first.eventId` and `retried.eventId` are identical. The duplicate adds no second event or score
contribution.

When importing existing history rather than reporting live activity, add `occurredAt` with the
original ISO timestamp. The event is then signed, ordered, and scored at that time instead of the
time it was received. It must be in the past and within the relay's accepted age, and it counts as
part of the idempotency key's content.

## 3. Query history and cursors

`GET /v1/events` is public. Filter with `source`, `type`, and `actor`, and set `limit` from 1 to 100.
When `meta.hasMore` is true, pass `meta.nextCursor` unchanged as the next request's `cursor`. Cursors
are opaque: do not decode, edit, cache permanently, or combine one cursor with different filters. A
malformed or unavailable cursor returns `400`.

The gateway returns only events whose Nostr signature and source identity are valid. The
`provenance.payloadClaimsVerified` field remains `false`; a valid signature proves who submitted the
payload, not that every payload claim is true.

## 4. Subscribe and reconnect

Connect to `GET /v1/events/stream` with the same optional `source`, `type`, and `actor` filters. The
response is `text/event-stream`; each Activity event arrives in an SSE `data:` field and has its
Nostr event ID as the SSE `id`.

If the connection drops, reconnect with the last processed ID in the `Last-Event-ID` request header.
The server replays later matching events before continuing live. Persist the ID only after your
consumer finishes processing that event. Use exponential backoff with jitter for network failures
and `503` responses. A `400` for `Last-Event-ID` means the value is malformed or no longer available
in relay history; recover by querying `GET /v1/events` and establishing a new checkpoint.

## 5. Read scoring

`GET /v1/leaderboard?period=weekly|monthly|all-time` returns current rankings. Optional `source` and
`type` filters isolate one integration. Scores are dynamic: when a source owner changes an Event
Type's point value, historical accepted events use the new value immediately. Platform-admin trust
multipliers also apply at read time. Consumers should display the returned score and breakdown
rather than caching their own permanent calculation.

## 6. Show endorsements

Signed-in Activity users can endorse a visible event once. Endorsements are a local interaction
record: they never modify the signed Nostr event, and they are not negative votes or a score input.

If you render a feed of your own events, fetch counts for up to 100 at a time rather than one
request per card:

```http
POST /v1/events/endorsements
Content-Type: application/json

{ "eventIds": ["<64-character Nostr event ID>"] }
```

The response maps each event ID to `{ eventId, totalCount, endorsedByCurrentUser }`, where
`endorsedByCurrentUser` reflects the session making the request and is `false` when signed out.
A signed-in user endorses with `POST /v1/events/{eventId}/endorsement` and withdraws with `DELETE`
on the same path; both are idempotent and return the updated total.

## 7. Check service health

`GET /v1/health` is public and needs no credentials. It returns `200` only when the database, a
real Redis write, and a relay query all succeed, and `503` with the same report naming the failed
check otherwise. Read it before investigating your own integration: a `503` from submission during
a relay outage is Activity's problem, not yours.

## 8. Handle failures safely

| Status | Meaning | Client action |
| --- | --- | --- |
| `400` | Invalid actor, Event Type, payload, filter, cursor, or resume ID | Fix the request; do not retry unchanged. |
| `401` | Missing, invalid, or revoked Source API Key | Stop publishing and replace the secret. |
| `403` | Source was rejected, or lacks a bound Signing Identity | Repair the source or its binding before retrying. |
| `409` | The idempotency key was already used with different content | Generate a new key for the new logical event. |
| `429` | A source under review reached its daily event limit | Retry tomorrow, or wait for approval, which lifts the limit. |
| `503` | Relay or Redis cannot complete the operation safely | Retry with backoff and the exact same idempotency key and body. |

The gateway reserves and signs a submission before publishing it. If relay acknowledgement is lost,
an identical retry republishes the same signed event ID. Never change the body while retrying an
idempotency key. During a relay outage, submissions and feed/SSE reads can return `503`; buffer work
durably on the producer side and retry. During a Redis outage, ingestion fails closed with `503`
rather than accepting an event without its score projection. The production failure and rollback
procedures are completed by infrastructure ticket #12.

### Retract an event you published

Events are immutable, but a source can hide one of its own events when the action behind it is
undone, such as a revoked approval or a rolled-back claim. Send the same Source API Key:

```http
POST /api/v1/events/<event-id>/retract
Authorization: Bearer act_<source-api-key>
Content-Type: application/json

{ "reason": "Approval revoked", "idempotencyKey": "retract:approval:42" }
```

The event leaves the public feed, SSE replay, and leaderboard exactly as an administrator hide
would; the signed relay record is unchanged. Retracting another source's event returns `403`.
Repeating the request with the same idempotency key and reason is safe; reusing the key with a
different reason returns `409`. A retracted event cannot be restored, and re-submitting its
idempotency key returns the same hidden event, so a later re-approval needs a new key.

## 9. Rotate or revoke credentials

To replace a Source API Key, create a second key, install it in the producer, verify successful
submissions, then revoke the old key. Revoked keys return `401` immediately and cannot be restored.

Signing Identity rotation is separate. Select **Rotate identity**; the setup panel returns to
**Link on-chain**, and your existing API keys work again once the new key is linked. Historical events remain verifiable with
the retired public identity during its recorded active window. Do not revoke the working API key as
a substitute for Signing Identity rotation.

## 10. API reference and CI proof

The generated interactive OpenAPI reference is available at `/api` on the Activity host and at the
API service's displayed **Docs** URL during `bun run dev`. Its public Activity operations are derived
directly from `api/src/contract.ts`: event submission, filtered feed, SSE, endorsements, leaderboard,
and leaderboard status.

The repository runs the same dependency-free example in CI with:

```bash
bun run test:integration-guide
```

The smoke test provisions a fresh approved and bound fixture source, receives its one-time API key,
executes the documented example through the public HTTP routes, verifies duplicate identity and
score count, and asserts that its output contains no credential.

## 11. Use a typed client

Every operation in this guide is also reachable over oRPC at `/api/rpc`, with the same
authentication: a Source API Key in the `Authorization` header for ingestion, and a session cookie
for anything requiring a signed-in user. The two surfaces are the same handlers, so nothing behaves
differently between them.

The [`@nearbuilders/activity-client`](../packages/client/) package contains the Activity contract
and a typed `createActivityClient` helper. It is ready to install from npm once published. The
helper takes the site's base URL, adds `/api/rpc`, and includes session cookies in browser requests.
Pass a Source API Key only from server-side code:

```ts
import { createActivityClient } from "@nearbuilders/activity-client";

const activity = createActivityClient("https://activity.nearbuilders.org", {
  apiKey: process.env.ACTIVITY_API_KEY,
});

const feed = await activity.listActivityEvents({ limit: 5 });
```

For a browser session, omit `apiKey`. The helper sends Source API Keys as
`Authorization: Bearer act_...`, matching the HTTP endpoint. If your project runs on
[everything.dev](https://everything.dev/), you can also add Activity to `bos.config.json` and run
`bos types gen` to include its contract in the generated in-process client. For a dependency-free
HTTP client, copy [`examples/activity-client.ts`](../examples/activity-client.ts).
