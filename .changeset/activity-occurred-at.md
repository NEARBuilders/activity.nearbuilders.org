---
"api": minor
---

Accept an optional `occurredAt` on event submission, so imported history is signed, ordered, and
scored at the time the activity happened instead of the time it was received. It must be in the
past and within the relay's accepted age, and it forms part of the idempotency key's content. Events
dated before their Signing Identity was bound are accepted only when the submission ledger shows
this service published them; relay records claiming to predate their identity are still discarded.
