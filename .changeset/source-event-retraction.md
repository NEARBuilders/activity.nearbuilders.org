---
"api": patch
---

Add `POST /api/v1/events/{eventId}/retract`, which lets a Source API Key hide an event its own source
published, for compensation and revocation. It reuses administrator moderation, so the event leaves
the feed, SSE replay, and leaderboard the same way, and the audit records `source:<sourceId>` as the
requester. Retracting another source's event returns `403`.
