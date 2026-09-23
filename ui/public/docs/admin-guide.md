# Administer Activity

For Platform Administrators of `activity.nearbuilders.org`. External projects publishing events
should read [`integration-guide.md`](/docs/integration-guide) instead; operators running the relay,
Redis, and backups should read [`activity-infrastructure.md`](https://github.com/NEARBuilders/activity.nearbuilders.org/blob/main/docs/activity-infrastructure.md).

## Who can do what

| Role | Held by | Can |
| --- | --- | --- |
| Visitor | anyone, signed out | Read the public feed and leaderboards |
| Signed-in user | any NEAR account | Endorse events |
| Organization owner | the owner of the organization that registered a source | Register and edit that source, create its Signing Identity and API keys, configure GitHub polling, retract its own events |
| Platform Administrator | a user whose account `role` is `admin` | Everything above, plus review sources, set source trust, and hide any event |

A Platform Administrator is a property of the **user account**, not of an organization. The role is
global: one administrator can review every source on the service. Administrators are not
automatically owners of any organization, so a source still has to be registered by its own owner.

## Become a Platform Administrator

Promoting someone needs an existing administrator's session. The **first** administrator on a fresh
deployment has to be set directly in the auth database, because nobody can grant the role yet.

### Bootstrapping the first administrator

The user must sign in with NEAR once so their account exists. Then, against the auth database:

```sql
UPDATE "user" SET role = 'admin'
WHERE id = (SELECT user_id FROM near_account WHERE account_id = 'someone.near');
```

Check that exactly one row matched before committing. The user must sign out and back in for the
new role to appear in their session.

### Promoting anyone afterwards

An existing administrator can promote another user over HTTP, with no database access, using the
auth service's admin API. Send the administrator's session cookie:

```bash
# Find the user's id
curl -s 'https://activity.nearbuilders.org/api/auth/admin/list-users?limit=50' \
  -H "cookie: $ADMIN_SESSION_COOKIE"

# Grant the role
curl -s -X POST 'https://activity.nearbuilders.org/api/auth/admin/set-role' \
  -H "cookie: $ADMIN_SESSION_COOKIE" -H 'content-type: application/json' \
  -d '{"userId": "<user id>", "role": "admin"}'
```

`list-users` searches the user table (name, email). NEAR accounts live in a separate `near_account`
table, so to find someone by NEAR account use the query in the bootstrap section to resolve
`user_id` first.

Removing an administrator is the same call with `"role": "user"`.

## Review Activity Sources

Sources appear in the **Source review queue** on `/activity-sources`, visible only to
administrators. Each pending source shows its source ID, display name, NEAR account, owning
organization, and declared Event Types.

Approving is what lets a source ingest events at all: `canIngest` follows `approvalStatus` exactly.
It is separate from trust, which only affects scoring.

Every decision needs a written reason (1–1000 characters). Reasons are kept in an append-only
history with the administrator and timestamp, and are visible to the source owner.

Two rules to know:

- **A source can be reviewed only while it is pending, and approval is one-way.** Reviewing a
  source that is already approved or rejected returns `409 Conflict`. There is no "unapprove", and
  **an administrator has no way to stop an approved source from publishing**: revoking API keys is
  owner-only, and there is no route to disable or suspend a source. The only administrator remedy
  today is hiding events one at a time, or asking the owner to revoke the key. Treat approval as
  the decision point, and confirm the source and its owner before granting it.
- **Editing a source sends it back to the queue.** If an owner changes the display name, NEAR
  account, or Event Types, the source returns to `pending` and its previous review is cleared, so
  it stops ingesting until it is reviewed again. Changing the NEAR account additionally unbinds the
  Signing Identity, so the owner must re-authorize it on-chain before publishing resumes.

Before approving, confirm the NEAR account really belongs to the project, because it is the account
that will have to sign the on-chain binding, and events are attributed to that source afterwards.

## Set source trust and score multipliers

The **Source trust controls** section on the same page designates a source `standard` or `trusted`
and sets its score multiplier. Trust is independent of approval: a pending source can be designated
in advance, and a trusted source still cannot ingest until it is approved.

| Designation | Multiplier | Meaning |
| --- | --- | --- |
| `standard` | must be exactly `1` | Events score at their Event Type's point value |
| `trusted` | `1` to `10` | Events score at point value times the multiplier |

Changes apply **retroactively and immediately**: leaderboards multiply raw counts by the current
point value and current multiplier at read time, so a change re-ranks history on the next request
without republishing anything. There is no backfill to wait for and no way to apply a multiplier to
only part of a source's history.

Every change records the administrator, the old and new values, the reason, and the timestamp in an
append-only trust history shown next to the control.

## Hide an event

Events are immutable and are never deleted; they stay on the relay, signed, forever. Hiding is a
local suppression that removes an event from this service's public views.

**There is no UI for this yet.** It is an administrator-session API call:

```bash
curl -s -X POST "https://activity.nearbuilders.org/api/activity/events/<event id>/hide" \
  -H "cookie: $ADMIN_SESSION_COOKIE" -H 'content-type: application/json' \
  -d '{"reason": "Why this is being hidden", "idempotencyKey": "moderation:<something stable>"}'

# Review what is hidden and why
curl -s 'https://activity.nearbuilders.org/api/activity/hidden-events' -H "cookie: $ADMIN_SESSION_COOKIE"
```

Hiding removes the event from feed queries, live delivery, and SSE replay, and excludes it from
leaderboard counts. Repeating the call with the same `idempotencyKey` and reason is safe; reusing
that key with a different reason returns `409`.

**Hiding cannot be undone through the API.** Treat it as permanent for the public surface, and note
that the signed event remains readable by anyone querying the relay directly, so hiding is not a
way to retract information that has already been published.

Source owners can hide their own source's events without an administrator, using their API key
against `POST /api/v1/events/{eventId}/retract`; see
[the integration guide](/docs/integration-guide#retract-an-event-you-published). That is the right
path for a project undoing its own action, such as a revoked approval. Administrator hiding is for
moderation across sources.

## Check service health

`GET /api/v1/health` is public and returns `200` only when the database, a real Redis write, and a
relay query all succeed; otherwise `503` with the same report naming the failed check. A scheduled
workflow calls it every 15 minutes, and a daily workflow backs up the relay and proves the backup
restores. Failure triage for each check, and the alert configuration, are in
[`activity-infrastructure.md`](https://github.com/NEARBuilders/activity.nearbuilders.org/blob/main/docs/activity-infrastructure.md#health-check).

`GET /api/v1/leaderboard/status` reports whether the scoring projection is ready, and the counters
from its last rebuild.

## What administrators cannot do

- Un-hide an event, or edit or delete any published event.
- Revoke an approval, or disable, suspend, or rate-limit an approved source. Revoking its API keys
  is owner-only. This is a known gap, not a deliberate design.
- See any source's private signing key. Keys are encrypted at rest and only ever decrypted inside a
  signing operation.
- Publish events on a source's behalf, or create API keys for a source they do not own.
- Change scores directly. Scores are always counts times the current point value and multiplier;
  adjust the Event Type's point value (the source owner) or the source multiplier (an administrator).
