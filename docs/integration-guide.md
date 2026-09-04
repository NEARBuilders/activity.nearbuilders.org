# Integrate with Activity

This guide takes an external project from registration to a verified event, live updates, and a
leaderboard result. The HTTP examples use `http://localhost:3000/api`; replace it with the deployed
Activity API base URL outside local development.

## 1. Register a source

1. Sign in to Activity with the NEAR account that will own the source.
2. Select or create an organization in the workspace menu. You must be an owner of that organization.
3. Open `/activity-sources` and register a source ID, display name, NEAR account, and at least one
   Event Type. Event Type names are lowercase names such as `feedback.submitted`.
4. Ask an Activity Platform Administrator to approve the pending source. Approval controls whether
   it may publish; the separate `standard` or `trusted` designation controls scoring weight.
5. Create the Signing Identity. Activity shows only its public key and encrypts the private key at rest.
6. Choose **Authorize with NEAR**, approve the mainnet binding transaction from the exact source
   account, wait for it to be indexed, and choose **Check binding**.
7. Create a Source API Key. Copy the `act_…` value immediately because it is shown once.

Store the Source API Key in the deployment platform's encrypted secret manager. Never place it in
source code, client-side JavaScript, logs, screenshots, issue bodies, `.env.example`, or committed
`.env` files. Treat the key as a server-side bearer credential.

## 2. Run the typed example

[`examples/activity-client.ts`](../examples/activity-client.ts) is dependency-free TypeScript built
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
