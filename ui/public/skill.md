# Add Activity to a project

Use this skill when someone asks you to integrate activity.nearbuilders.org, add Activity, report
activity or events to NEAR Builders, or show their users on the Activity leaderboard.

Activity is a shared, publicly verifiable record of what people do across the NEAR ecosystem. A
project reports events (a user merged a pull request, completed a task, submitted feedback);
Activity signs them with the project's own key, publishes them to Nostr, and scores them on public
leaderboards.

You do almost all of the setup. The person signs in and approves one wallet transaction, which
proves they own the project's NEAR account. You never handle their wallet or keys.

Base URL: `https://activity.nearbuilders.org`. If the person runs Activity locally, use their URL
instead, such as `http://localhost:3000`.

## 1. Identify the project

Look for the project's nearbuilders.org page: a link in the README, website, or package metadata, of
the form `https://nearbuilders.org/projects/<slug>`. If you cannot find one, ask the person for it.
A project slug or exact project name also works. If the project is not on nearbuilders.org, continue
without it and choose the name and Source ID yourself.

## 2. Propose Event Types

Read the codebase and find the meaningful things users do: actions with a clear actor and a clear
moment. Prefer a few well-named types over many.

- Names are lowercase, dot or dash separated, such as `task.completed` or `pull-request.merged`.
- Each has a `pointValue` (whole number, 0 or more) and an optional `description`.
- The actor of every event must be a NEAR account ID, such as `alice.near`. Only report actions
  where you know the user's NEAR account.

The person can adjust these before registering, so a reasonable first draft is enough.

## 3. Start a binding session

```bash
curl -sS -X POST https://activity.nearbuilders.org/api/v1/binding-sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "project": { "reference": "https://nearbuilders.org/projects/<slug>" },
    "eventTypes": [
      { "name": "task.completed", "description": "A user completed a task", "enabled": true, "pointValue": 5 }
    ]
  }'
```

Optional fields: `sourceId`, `displayName`, and `nearAccountId` override what the project lookup
fills in. Without a project, send `displayName` and `sourceId` yourself. For a nearbuilders.org
project, `nearAccountId` must be the project owner's account (or the project's linked app account):
Activity refuses any other account, and the person must sign in with it to finish.

Keep `pollToken` and `sessionId` private and in memory; do not write them to files or print the poll
token. Handle errors:

- `400` listing several project links: ask the person which one, then retry with that link.
- `404`: the project was not found. Ask for the correct link.
- `429`: wait a few minutes before retrying.

## 4. Hand the link to the person

Tell them, using the `url` and `matchCode` from the response:

> Open this link and sign in with your NEAR wallet: `<url>`
> Check that the page shows the code **`<matchCode>`**. If it shows a different code, close it.
> Then confirm the details and approve the wallet transaction (about 0.0001 NEAR). Tell me when the
> page says "Return to your agent".

## 5. Claim the Source API Key

Poll every 5 seconds until the status changes. The link expires after 30 minutes.

```bash
curl -sS -X POST "https://activity.nearbuilders.org/api/v1/binding-sessions/$SESSION_ID/claim" \
  -H "Authorization: Bearer $POLL_TOKEN" -H 'Content-Type: application/json' -d '{}'
```

- `waiting`: keep polling.
- `ready`: the response has `secret` (the `act_…` key) and `sourceId`. The key is returned only this
  once, so store it immediately (next step).
- `claimed`: the key was already returned. Ask the person to create a new key on
  `/activity-sources` if it was lost.
- `expired`: start a new session.

## 6. Store the key as a server-side secret

Save it as `ACTIVITY_API_KEY`, and the source ID as `ACTIVITY_SOURCE_ID`, in the project's local
`.env` (confirm `.env` is gitignored first) and tell the person to add the same values to their
deployment's secret manager. Never commit the key, put it in client-side code, log it, or paste it
in full back into the conversation.

## 7. Write the integration

Send events from server-side code only. A dependency-free helper:

```ts
const ACTIVITY_URL = "https://activity.nearbuilders.org/api/v1/events";

export async function reportActivity(event: {
  eventType: string;
  actor: string;
  idempotencyKey: string;
  payload?: unknown;
}) {
  const response = await fetch(ACTIVITY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ACTIVITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload: {}, ...event }),
  });
  if (!response.ok) {
    throw new Error(`Activity rejected the event: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as { eventId: string };
}
```

- `idempotencyKey` must be stable for one logical event (for example `task:<taskId>:completed`), so
  a retry never double-counts. Reusing a key with different content returns `409`.
- `payload` is any JSON up to 16 KiB. Do not put secrets or private personal data in it: events are
  public and permanent.
- Report events after the action has really happened, and do not let a failed report break the
  user's action: log and retry later instead.
- Retry `503` with backoff and the exact same body. Fix the request on `400`. `401` means the key is
  wrong or revoked. `403` means the source was rejected or is not linked on-chain. `429` means a
  source under review hit its 500-events-per-day limit.

## 8. Send a test event and report back

Send one event with a real NEAR account as `actor`, then check it at
`https://activity.nearbuilders.org/activity`. Tell the person:

- the source is **Under review**: events are accepted and visible now, and count on leaderboards
  once a Platform Administrator approves it;
- which Event Types you added and where in the code each one is reported;
- that the key is in `.env` locally and must be added to their deployment's secrets.

Full reference: https://activity.nearbuilders.org/docs/integration-guide
