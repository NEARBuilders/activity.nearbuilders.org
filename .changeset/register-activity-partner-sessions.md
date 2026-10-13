---
"api": minor
"ui": minor
---

Let nearbuilders.org start Activity setup for a project owner ("Register Activity"). An approved,
trusted source can authenticate `POST /api/v1/binding-sessions` with its Source API Key to start a
partner session for a nearbuilders.org project, optionally naming the owner's NEAR account. Partner
sessions return no poll token: the owner completes setup on `/binding`, which asks them to sign in
with that NEAR account when one is given, and the Source API Key is shown once on that page through
`POST /api/activity/binding-sessions/reveal`. A second reveal is refused.

Any source can send the reserved `activity.test` Event Type to check its connection. Test events
are never stored, signed, published, or scored; they only update the source's last test time,
readable from `GET /api/activity/sources/{sourceId}/test-status`, which `/binding` uses to show
"Connection works".

`GET /api/v1/projects/{projectId}/activity` reports whether a nearbuilders.org project's source is
`none`, `connected`, `tracked` (has published events), or `rejected` (with the review reason).

Event Type point values are now capped at 100. Registering or editing a source with a higher point
value returns a validation error; existing Event Types are unchanged.
