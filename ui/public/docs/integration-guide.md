# Integrate with Activity

This guide takes an external project from registration to a verified event, live updates, and a
leaderboard result. The HTTP examples use `http://localhost:3000/api`; replace it with the deployed
Activity API base URL outside local development, which is `https://activity.nearbuilders.org/api`.

## Before you start

**Activity is a plain HTTP API.** There is nothing to install: you authenticate with a bearer token
and send JSON. It is not a plugin, and you do not need to run Nostr or Redis yourself. If your
project is built on [everything.dev](https://everything.dev/), there is also a typed oRPC client —
see [Use a typed client](#9-use-a-typed-client-inside-everythingdev).

You will need:

- A **mainnet NEAR account** for the source, funded with about **0.01 NEAR** plus gas. One on-chain
  transaction from this exact account links it to the source's signing key.
- An **organization** in Activity that you own.
- A **Platform Administrator** to approve the source.

Budget for this realistically. Sending your first event once you hold an API key takes a couple of
minutes, but two steps before that are not instant:

| Step | Who | How long |
| --- | --- | --- |
| Register the source | You | Minutes |
| Approve the source | A Platform Administrator | Until a human gets to it |
| Authorize the signing key on-chain | You, from the source's NEAR account | A transaction plus indexing |
| Create an API key and publish | You | Minutes |

Publishing returns `403` until the source is both approved and bound, so arrange approval before
you plan a demo.

## 1. Register a source

Everything in this section happens in the browser, and it is the only part that needs a NEAR
wallet. Before starting, have the **mainnet NEAR account that will own the source**, funded with a
small amount for one transaction (about 0.01 NEAR plus gas).

1. **Sign in** with that NEAR account.
2. **Select or create an organization** in the workspace menu. You must be its **owner**: members
   cannot register sources or manage credentials. A source belongs to one organization permanently.
3. **Register the source** on `/activity-sources`:
   - **Source ID** — lowercase, permanent, and shown publicly on every event, such as
     `github.nearbuilders.org`. It cannot be changed later.
   - **Display name** — shown on feed cards.
   - **NEAR account** — the exact mainnet account that will sign the binding in step 6.
   - **Event Types** — at least one, lowercase, such as `feedback.submitted`. Each carries a point
     value used for scoring, and can be enabled or disabled. Add every type you expect to publish;
     submitting a type that is missing or disabled returns `400`.
4. **Wait for approval.** A Platform Administrator approves or rejects with a written reason, which
   you can see on the source. Approval is what allows publishing at all. The separate `standard` or
   `trusted` designation only affects scoring weight, and you do not need `trusted` to start.
5. **Create the Signing Identity.** Activity generates a Nostr keypair for the source, shows you
   only the public key, and encrypts the private key at rest. It is never shown or exported.
6. **Authorize with NEAR.** Choose **Authorize with NEAR**, and approve the mainnet transaction
   **from the source's exact NEAR account** — a different account, even one you also control, is
   rejected. This writes the binding between the NEAR account and the signing key on-chain, and it
   goes directly through your wallet, so no relayer is involved. Wait a few seconds for it to be
   indexed, then choose **Check binding**. Until this succeeds, publishing returns `403`.
7. **Create a Source API Key.** Copy the `act_…` value immediately: it is shown once and only its
   name, prefix, and timestamps are visible afterwards.

Store the Source API Key in the deployment platform's encrypted secret manager. Never place it in
source code, client-side JavaScript, logs, screenshots, issue bodies, `.env.example`, or committed
`.env` files. Treat the key as a server-side bearer credential.

**Editing a source later sends it back for review.** Changing the display name, NEAR account, or
Event Types returns the source to `pending`, and it stops ingesting until an administrator reviews
it again. Changing the NEAR account also unbinds the Signing Identity, so step 6 has to be repeated
from the new account. Plan Event Types up front where you can.

### Polling GitHub instead of publishing

An approved source can have Activity poll public GitHub repositories for it, rather than calling
the API itself. Add `github.pr.merged` and/or `github.issue.closed` as Event Types, then configure
repositories on the source. Every GitHub login must be explicitly mapped to the NEAR account that
should receive credit; events from unmapped authors are quarantined until a mapping exists rather
than being attributed to the wrong person. See
[`activity-protocol.md`](/docs/activity-protocol#github-repository-polling) for polling intervals,
rate limits, and backfill boundaries.

## 2. Run the typed example

[`examples/activity-client.ts`](https://github.com/NEARBuilders/activity.nearbuilders.org/blob/main/examples/activity-client.ts) is dependency-free TypeScript built
on the standard Fetch, Web Streams, and AbortSignal APIs. It submits an event, repeats the exact
request, proves both calls return the same event ID, queries the event, receives a second event over
SSE, and reads the all-time leaderboard.

Run the wrapper from this repository:

```bash
ACTIVITY_API_BASE_URL=http://localhost:3000/api \
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

## 6. Handle failures safely

| Status | Meaning | Client action |
| --- | --- | --- |
| `400` | Invalid actor, Event Type, payload, filter, cursor, or resume ID | Fix the request; do not retry unchanged. |
| `401` | Missing, invalid, or revoked Source API Key | Stop publishing and replace the secret. |
| `403` | Source is unapproved, disabled, or lacks a bound Signing Identity | Repair source approval/binding before retrying. |
| `409` | The idempotency key was already used with different content | Generate a new key for the new logical event. |
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

## 7. Rotate or revoke credentials

To replace a Source API Key, create a second key, install it in the producer, verify successful
submissions, then revoke the old key. Revoked keys return `401` immediately and cannot be restored.

Signing Identity rotation is separate. Select **Rotate identity**, provide an audit reason, authorize
the new NEAR binding, and verify it before resuming writes. Historical events remain verifiable with
the retired public identity during its recorded active window. Do not revoke the working API key as
a substitute for Signing Identity rotation.

## 8. API reference and CI proof

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

## 9. Use a typed client inside everything.dev

Every operation in this guide is also reachable over oRPC at `/api/rpc`, with the same
authentication: a Source API Key in the `Authorization` header for ingestion, and a session cookie
for anything requiring a signed-in user. The two surfaces are the same handlers, so nothing behaves
differently between them.

```ts
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

const client = createORPCClient(
  new RPCLink({ url: "https://activity.nearbuilders.org/api/rpc" }),
);

const feed = await client.listActivityEvents({ limit: 5 });
```

**Which surface you should use depends on where your project lives.**

- **Inside everything.dev.** Add Activity to your `bos.config.json` and run `bos types gen`. You get
  a generated contract, so `createORPCClient<ApiClient>(...)` is fully typed, and the plugin client
  composes in-process without an HTTP round trip. This is the better path, and it is what
  nearbuilders.org uses.
- **Outside everything.dev.** The contract is not published as an installable package, so an oRPC
  client here is untyped and you gain nothing over `fetch`. Use the HTTP calls in the sections
  above, or copy [`examples/activity-client.ts`](https://github.com/NEARBuilders/activity.nearbuilders.org/blob/main/examples/activity-client.ts), which is
  dependency-free and carries its own types.
